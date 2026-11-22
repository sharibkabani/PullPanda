import { afterAll, beforeAll, expect, test } from "bun:test";
import { REVIEW_JOB_OPTIONS, reviewJobId, signGithubPayload, type ReviewJobData } from "@pullpanda/core";
import { createDb, orm, reviews } from "@pullpanda/db";
import { Queue, QueueEvents, UnrecoverableError, Worker } from "bullmq";
import IORedis from "ioredis";
import { createApp } from "../../api/src/app";
import { loadEnv } from "../../api/src/env";
import { FakeGitHub, FakeModel, PATCH } from "../../../packages/core/test/fakes";
import { isPermanent, markFailed, processReviewJob } from "../src/process";

/**
 * Full pipeline with real Postgres + Redis + BullMQ: signed webhook -> API -> queue -> worker -> GitHub review.
 * Only GitHub and the LLM are faked.
 */
const DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://pullpanda:pullpanda@localhost:5432/pullpanda_test";
const QUEUE = `pr-reviews-e2e-${Date.now()}`;
const SECRET = "e2e-secret";
const db = createDb(DB_URL);
const redis = new IORedis(process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1", { maxRetriesPerRequest: null });
const queue = new Queue<ReviewJobData>(QUEUE, { connection: redis });
const events = new QueueEvents(QUEUE, { connection: redis.duplicate() });

const pr = { title: "Add user lookup", body: null, draft: false, state: "open" as const, headSha: "e2e-sha", baseRef: "main" };
const github = new FakeGitHub(pr, [{ path: "src/users.ts", status: "modified", additions: 2, deletions: 1, patch: PATCH }]);
let failGitHubWith: number | null = null;
const model = new FakeModel(() => [
  { path: "src/users.ts", line: 3, severity: "critical", category: "security", title: "SQL injection", body: "Parameterize this query." },
]);

let worker: Worker<ReviewJobData>;

beforeAll(async () => {
  await db.execute(orm.sql`truncate users, installations, repositories, reviews, user_installations, processed_events cascade`);
  worker = new Worker<ReviewJobData>(
    QUEUE,
    async (job) => {
      try {
        if (failGitHubWith) throw Object.assign(new Error(`GitHub ${failGitHubWith}`), { status: failGitHubWith });
        return await processReviewJob(job.data, job.attemptsMade + 1, { db, model, githubFor: () => github });
      } catch (err) {
        if (isPermanent(err)) throw new UnrecoverableError((err as Error).message);
        throw err;
      }
    },
    { connection: redis.duplicate() },
  );
  worker.on("failed", async (job, err) => {
    if (job) await markFailed(db, job.data.reviewId, err);
  });
  await worker.waitUntilReady();
});

afterAll(async () => {
  await worker.close();
  await queue.obliterate({ force: true });
  await queue.close();
  await events.close();
  redis.disconnect();
});

const app = createApp({
  env: loadEnv({ NODE_ENV: "test", DATABASE_URL: DB_URL, GITHUB_WEBHOOK_SECRET: SECRET }),
  db,
  enqueueReview: async (job) => void (await queue.add("review", job, { ...REVIEW_JOB_OPTIONS, attempts: 1, jobId: reviewJobId(job) })),
  claimDelivery: async () => true,
  releaseDelivery: async () => {},
  oauth: null,
  billing: null,
  health: async () => ({}),
});

function webhook(sha: string) {
  const body = JSON.stringify({
    action: "opened",
    installation: { id: 77 },
    repository: { id: 700, name: "api", full_name: "acme/api", private: false, owner: { id: 1, login: "acme", type: "Organization" } },
    pull_request: { number: 12, head: { sha } },
  });
  return new Request("http://api.test/webhooks/github", {
    method: "POST",
    headers: { "x-github-event": "pull_request", "x-github-delivery": crypto.randomUUID(), "x-hub-signature-256": signGithubPayload(SECRET, body) },
    body,
  });
}

async function waitForJob(reviewId: string) {
  const job = (await queue.getJobs(["waiting", "active", "completed", "failed", "delayed"])).find((j) => j.data.reviewId === reviewId)!;
  await job.waitUntilFinished(events, 10_000).catch(() => undefined);
  // The failed-handler writes to Postgres asynchronously after BullMQ settles the job.
  for (let i = 0; i < 50; i++) {
    const [row] = await db.select().from(reviews).where(orm.eq(reviews.id, reviewId));
    if (row && row.status !== "queued" && row.status !== "running") return row;
    await Bun.sleep(20);
  }
  return (await db.select().from(reviews).where(orm.eq(reviews.id, reviewId)))[0]!;
}

test("a signed webhook results in an inline review on the PR and a completed row", async () => {
  const res = await app.handle(webhook("e2e-sha"));
  expect(res.status).toBe(202);
  const { reviewId } = await res.json() as any;

  const row = await waitForJob(reviewId);
  expect(row.status).toBe("completed");
  expect(row.commentsPosted).toBe(1);
  expect(row.inputTokens).toBe(100);
  expect(row.durationMs).toBeGreaterThanOrEqual(0);

  expect(github.reviews).toHaveLength(1);
  expect(github.reviews[0]!.comments[0]).toMatchObject({ path: "src/users.ts", line: 3 });
  expect(github.reviews[0]!.body).toContain("PullPanda review");
});

test("a stale commit is skipped by the worker without calling the model", async () => {
  const calls = model.calls.length;
  const { reviewId } = await (await app.handle(webhook("old-sha"))).json() as any;
  const row = await waitForJob(reviewId);
  expect(row.status).toBe("skipped");
  expect(row.skipReason).toBe("superseded by a newer commit");
  expect(model.calls.length).toBe(calls);
});

test("a permanent GitHub error fails the job immediately and is recorded", async () => {
  failGitHubWith = 403;
  github.pr = { ...pr, headSha: "forbidden-sha" };
  const { reviewId } = await (await app.handle(webhook("forbidden-sha"))).json() as any;
  const row = await waitForJob(reviewId);
  failGitHubWith = null;
  expect(row.status).toBe("failed");
  expect(row.error).toContain("GitHub 403");
});

test("re-running a completed job never double-posts", async () => {
  const [done] = await db.select().from(reviews).where(orm.eq(reviews.status, "completed"));
  const before = github.reviews.length;
  const out = await processReviewJob(
    { installationId: 77, owner: "acme", repo: "api", repositoryId: 700, prNumber: 12, headSha: "e2e-sha", reviewId: done!.id, plan: "free" },
    2,
    { db, model, githubFor: () => github },
  );
  expect(out.status).toBe("duplicate");
  expect(github.reviews.length).toBe(before);
});

test("a crash between posting and recording is healed on retry, without a second post", async () => {
  const [done] = await db.select().from(reviews).where(orm.eq(reviews.status, "completed"));
  // Simulate the lost write: GitHub has the review, Postgres doesn't know.
  await db.update(reviews).set({ status: "running", githubReviewId: null }).where(orm.eq(reviews.id, done!.id));
  const before = github.reviews.length;
  const calls = model.calls.length;
  github.pr = { ...pr, headSha: "e2e-sha" };
  const out = await processReviewJob(
    { installationId: 77, owner: "acme", repo: "api", repositoryId: 700, prNumber: 12, headSha: "e2e-sha", reviewId: done!.id, plan: "free" },
    2,
    { db, model, githubFor: () => github },
  );
  expect(out.status).toBe("already-posted");
  expect(github.reviews.length).toBe(before);
  expect(model.calls.length).toBe(calls);
  const [row] = await db.select().from(reviews).where(orm.eq(reviews.id, done!.id));
  expect(row!.status).toBe("completed");
  expect(row!.githubReviewId).not.toBeNull();
});

test("GitHub 403s: rate limits retry, permission errors don't", () => {
  const err = (headers: Record<string, string>, message = "Forbidden") => Object.assign(new Error(message), { status: 403, response: { headers } });
  expect(isPermanent(err({}))).toBe(true);
  expect(isPermanent(err({ "x-ratelimit-remaining": "0" }))).toBe(false);
  expect(isPermanent(err({ "retry-after": "60" }))).toBe(false);
  expect(isPermanent(err({}, "You have exceeded a secondary rate limit"))).toBe(false);
});
