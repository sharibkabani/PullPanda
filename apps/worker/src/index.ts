import { createReviewModel, logger, OctokitGitHubClient, REVIEW_QUEUE, type ReviewJobData } from "@pullpanda/core";
import { createDb } from "@pullpanda/db";
import { UnrecoverableError, Worker } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import { isPermanent, markFailed, processReviewJob } from "./process";

const env = z
  .object({
    DATABASE_URL: z.string().default("postgres://pullpanda:pullpanda@localhost:5432/pullpanda"),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
    /** Optional: without it the Anthropic SDK also reads ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile. */
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_MODEL: z.string().optional(),
    ANTHROPIC_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_MODEL: z.string().optional(),
    GITHUB_APP_ID: z.string().min(1),
    GITHUB_APP_PRIVATE_KEY: z.string().min(1),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(4),
    /** Reviews started per minute across every replica: set it from your OpenAI rate limit. */
    WORKER_RATE_PER_MIN: z.coerce.number().int().min(1).default(30),
  })
  .parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""))); // blank `KEY=` means unset

const privateKey = env.GITHUB_APP_PRIVATE_KEY.includes("BEGIN")
  ? env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n")
  : Buffer.from(env.GITHUB_APP_PRIVATE_KEY, "base64").toString("utf8");

const db = createDb(env.DATABASE_URL);
const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
const deps = {
  db,
  model: createReviewModel(env),
  githubFor: (installationId: number) =>
    OctokitGitHubClient.forInstallation({ appId: env.GITHUB_APP_ID, privateKey }, installationId),
};

const worker = new Worker<ReviewJobData>(
  REVIEW_QUEUE,
  async (job) => {
    try {
      return await processReviewJob(job.data, job.attemptsMade + 1, deps);
    } catch (err) {
      // 4xx from GitHub won't fix itself: stop retrying and send straight to the failed set.
      if (isPermanent(err)) throw new UnrecoverableError((err as Error).message);
      throw err;
    }
  },
  {
    connection,
    concurrency: env.WORKER_CONCURRENCY,
    // Global rate limit protects the OpenAI and GitHub quotas across all worker replicas.
    limiter: { max: env.WORKER_RATE_PER_MIN, duration: 60_000 },
  },
);

worker.on("failed", async (job, err) => {
  if (!job) return;
  // BullMQ counts the attempt before emitting "failed": attemptsMade equals attempts on the last one.
  const finalAttempt = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
  logger.error({ reviewId: job.data.reviewId, attempt: job.attemptsMade, finalAttempt, err: err.message }, "review job failed");
  if (!finalAttempt) return;
  try {
    await markFailed(db, job.data.reviewId, err);
  } catch (dbErr) {
    // Never an unhandled rejection in an event handler; the row stays "running" and a replay picks it up.
    logger.error({ reviewId: job.data.reviewId, err: dbErr }, "could not mark review failed");
  }
});
worker.on("ready", () => logger.info({ queue: REVIEW_QUEUE, concurrency: env.WORKER_CONCURRENCY }, "worker ready"));

const shutdown = async () => {
  logger.info("draining worker");
  await worker.close(); // waits for in-flight jobs to finish
  connection.disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
