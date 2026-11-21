import { logger, OctokitGitHubClient, OpenAIReviewModel, REVIEW_QUEUE, type ReviewJobData } from "@pullpanda/core";
import { createDb } from "@pullpanda/db";
import { UnrecoverableError, Worker } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";
import { isPermanent, markFailed, processReviewJob } from "./process";

const env = z
  .object({
    DATABASE_URL: z.string().default("postgres://pullpanda:pullpanda@localhost:5432/pullpanda"),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    OPENAI_API_KEY: z.string().min(1),
    OPENAI_MODEL: z.string().default("gpt-5.4-mini"),
    GITHUB_APP_ID: z.string().min(1),
    GITHUB_APP_PRIVATE_KEY: z.string().min(1),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(4),
    /** Reviews started per minute across every replica: set it from your OpenAI rate limit. */
    WORKER_RATE_PER_MIN: z.coerce.number().int().min(1).default(30),
  })
  .parse(process.env);

const privateKey = env.GITHUB_APP_PRIVATE_KEY.includes("BEGIN")
  ? env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n")
  : Buffer.from(env.GITHUB_APP_PRIVATE_KEY, "base64").toString("utf8");

const db = createDb(env.DATABASE_URL);
const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
const deps = {
  db,
  model: new OpenAIReviewModel({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL }),
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
  const finalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1) || err instanceof UnrecoverableError;
  logger.error({ reviewId: job.data.reviewId, attempt: job.attemptsMade, finalAttempt, err: err.message }, "review job failed");
  if (finalAttempt) await markFailed(db, job.data.reviewId, err);
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
