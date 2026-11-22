/**
 * Worker drain benchmark. Runs the real job processor (Postgres status writes, diff parsing, batching,
 * finding validation) on a real BullMQ queue, with GitHub and the model replaced by stand-ins that
 * sleep for realistic latencies. Fill the queue first with bench/intake.ts.
 *
 *   bun bench/worker.ts --concurrency=64 --jobs=3000 --modelMs=2500 --label=w64
 */
import { REVIEW_QUEUE, type ChangedFile, type Finding, type GitHubClient, type ReviewBatchInput, type ReviewJobData, type ReviewModel } from "@pullpanda/core";
import { createDb, orm, reviews } from "@pullpanda/db";
import { processReviewJob } from "../apps/worker/src/process";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { arg, percentiles, round, sarg, writeResult } from "./lib";

const CONCURRENCY = arg("concurrency", 32);
const JOBS = arg("jobs", 2000);
const MODEL_MS = arg("modelMs", 2500);
const LABEL = sarg("label", `w${CONCURRENCY}`);
const db = createDb(process.env.DATABASE_URL);
const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379/2", { maxRetriesPerRequest: null });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Log-normal latency around a median: most calls near it, a long tail like a real API. */
const latency = (median: number) => Math.max(5, median * Math.exp(0.45 * gaussian()));
function gaussian() {
  const u = 1 - Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function fakePatch(lines: number) {
  const out = [`@@ -1,${lines} +1,${lines + 2} @@`];
  for (let i = 0; i < lines; i++) out.push(i % 9 === 3 ? `-old line ${i}` : i % 7 === 2 ? `+const value${i} = compute(${i});` : ` context line ${i} of the file`);
  out.push("+export const added = true;", "+// trailing");
  return out.join("\n");
}

class StandInGitHub implements GitHubClient {
  constructor(private sha: string) {}
  async getPullRequest() {
    await sleep(latency(80));
    return { title: "Bench change", body: "Load test", draft: false, state: "open" as const, headSha: this.sha, baseRef: "main" };
  }
  async listPullRequestFiles(): Promise<ChangedFile[]> {
    await sleep(latency(120));
    const n = 3 + Math.floor(Math.random() * 10);
    return Array.from({ length: n }, (_, i) => ({ path: `src/module${i}/file${i}.ts`, status: "modified", additions: 20, deletions: 5, patch: fakePatch(20 + Math.floor(Math.random() * 130)) }));
  }
  async findReview() {
    return null;
  }
  async getFileText() {
    await sleep(latency(60));
    return null;
  }
  async createReview() {
    await sleep(latency(250));
    return { id: Math.floor(Math.random() * 1e9) };
  }
}

const model: ReviewModel = {
  name: "stand-in",
  async reviewBatch(input: ReviewBatchInput) {
    await sleep(latency(MODEL_MS));
    const findings: Finding[] = input.files.slice(0, 3).map((f) => ({
      path: f.path,
      line: [...f.parsed.addedLines][0] ?? 1,
      severity: "warning",
      category: "bug",
      title: "Check this value",
      body: "Stand-in finding.",
    }));
    const tokens = input.files.reduce((a, f) => a + f.tokens, 0);
    return { summary: "Stand-in summary.", findings, usage: { inputTokens: tokens + 600, outputTokens: 180 } };
  },
};

const queue = new Queue<ReviewJobData>(REVIEW_QUEUE, { connection: redis });
// --wait: run alongside a live intake load and process exactly --jobs as they arrive.
const WAIT = process.argv.includes("--wait");
const waiting = await queue.getWaitingCount();
const target = WAIT ? JOBS : Math.min(JOBS, waiting);
if (target === 0) throw new Error("queue is empty: run bench/intake.ts first");
console.log(`draining ${target} of ${waiting} queued jobs at concurrency ${CONCURRENCY}, model median ${MODEL_MS}ms`);

let done = 0;
const ids: string[] = [];
const perSecond: number[] = [];
const start = performance.now();
const finished = Promise.withResolvers<void>();
const worker = new Worker<ReviewJobData>(
  REVIEW_QUEUE,
  async (job) => {
    const out = await processReviewJob(job.data, 1, { db, model, githubFor: () => new StandInGitHub(job.data.headSha) });
    ids.push(job.data.reviewId);
    const sec = Math.floor((performance.now() - start) / 1000);
    perSecond[sec] = (perSecond[sec] ?? 0) + 1;
    if (++done >= target) finished.resolve();
    return out;
  },
  { connection: redis.duplicate(), concurrency: CONCURRENCY },
);
await finished.promise;
const seconds = (performance.now() - start) / 1000;
await worker.close(true);

// Per-review time in the worker, from the durations it wrote to Postgres.
const rows = await db.select({ ms: reviews.durationMs, status: reviews.status }).from(reviews).where(orm.inArray(reviews.id, ids.slice(0, 20000)));
const result = {
  label: LABEL,
  concurrency: CONCURRENCY,
  modelMedianMs: MODEL_MS,
  jobs: target,
  seconds: round(seconds),
  reviewsPerSecond: round(target / seconds),
  reviewsPerHour: Math.round((target / seconds) * 3600),
  processingMs: percentiles(rows.map((r) => r.ms ?? 0)),
  statuses: rows.reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {}),
  perSecond: perSecond.map((n) => n ?? 0),
};
console.log(JSON.stringify({ ...result, perSecond: undefined }, null, 2));
console.log(writeResult(`worker-${LABEL}`, result));
await queue.close();
redis.disconnect();
process.exit(0);
