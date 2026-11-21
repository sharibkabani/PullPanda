import { logger, REVIEW_JOB_OPTIONS, REVIEW_QUEUE, reviewJobId, type ReviewJobData } from "@pullpanda/core";
import { createDb, orm } from "@pullpanda/db";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { createApp } from "./app";
import { loadEnv } from "./env";
import { createGitHubOAuth } from "./services/github-oauth";
import { createPolarBilling } from "./services/polar";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue<ReviewJobData>(REVIEW_QUEUE, { connection: redis });

const app = createApp({
  env,
  db,
  async enqueueReview(job) {
    await queue.add("review", job, { ...REVIEW_JOB_OPTIONS, jobId: reviewJobId(job) });
  },
  async claimDelivery(id) {
    return (await redis.set(`gh:delivery:${id}`, "1", "EX", 86_400, "NX")) === "OK";
  },
  async releaseDelivery(id) {
    await redis.del(`gh:delivery:${id}`);
  },
  oauth:
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? createGitHubOAuth(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET) : null,
  billing:
    env.POLAR_ACCESS_TOKEN && env.POLAR_WEBHOOK_SECRET && env.POLAR_PRO_PRODUCT_ID
      ? createPolarBilling({
          accessToken: env.POLAR_ACCESS_TOKEN,
          webhookSecret: env.POLAR_WEBHOOK_SECRET,
          productId: env.POLAR_PRO_PRODUCT_ID,
          environment: env.POLAR_ENVIRONMENT,
        })
      : null,
  async health() {
    const [dbOk, redisOk] = await Promise.all([
      db.execute(orm.sql`select 1`).then(() => true, () => false),
      redis.ping().then((r) => r === "PONG", () => false),
    ]);
    return { database: dbOk, redis: redisOk };
  },
}).listen(env.PORT);

logger.info(
  {
    port: env.PORT,
    github: Boolean(env.GITHUB_WEBHOOK_SECRET),
    oauth: Boolean(env.GITHUB_CLIENT_ID),
    billing: Boolean(env.POLAR_ACCESS_TOKEN),
  },
  "api listening",
);

const shutdown = async () => {
  logger.info("shutting down api");
  await app.stop();
  await queue.close();
  redis.disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
