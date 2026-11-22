/**
 * Condenses bench/results into apps/web/content/benchmarks.json, the one file the website's charts and
 * benchmark page are built from. Re-run after a new benchmark: bun bench/report.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "results");
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));

const intake = ["opt-c8", "opt-c32", "opt-c64", "opt-c128", "opt-c256"].map((l) => read(`intake-${l}.json`));
const scale = [1, 2, 4].map((n) => read(`intake-scale-n${n}.json`));
const workers = ["w16", "w64", "w256", "w1024"].map((l) => read(`worker-${l}.json`));
const burstIntake = read("intake-e2e-intake.json");
const burstWorker = read("worker-e2e-worker.json");
const depth = readFileSync(join(dir, "e2e-queue-depth.txt"), "utf8")
  .trim()
  .split("\n")
  .map((l) => Number(l.split(" ")[1]));
// trim the idle tail once the queue stayed empty
let last = depth.length - 1;
while (last > 0 && depth[last] === 0 && depth[last - 1] === 0) last--;
const race = { before: read("intake-race-one-installation.json").statuses["202"], after: read("intake-race-one-installation-fixed.json").statuses["202"], quota: 30, requests: 400 };

const out = {
  measuredOn: "Apple M4, 10 cores, 2026-11-20. Postgres 17 and Redis 7 in Docker on the same machine as the API, worker and load generator.",
  intake: intake.map((r) => ({ concurrency: r.concurrency, rps: r.throughputRps, p50: r.latencyMs.p50, p95: r.latencyMs.p95, p99: r.latencyMs.p99, requests: r.total })),
  scale: scale.map((r) => ({ instances: r.apiInstances, rps: r.throughputRps, p50: r.latencyMs.p50, p99: r.latencyMs.p99 })),
  workers: workers.map((r) => ({ concurrency: r.concurrency, reviewsPerSecond: r.reviewsPerSecond, reviewsPerHour: r.reviewsPerHour, p50: r.processingMs.p50, p95: r.processingMs.p95, jobs: r.jobs })),
  burst: {
    events: burstIntake.statuses["202"],
    duplicates: burstIntake.statuses["200 duplicate"],
    intakeSeconds: burstIntake.seconds,
    intakeRps: burstIntake.throughputRps,
    intakeP99: burstIntake.latencyMs.p99,
    reviews: burstWorker.jobs,
    drainSeconds: burstWorker.seconds,
    reviewsPerSecond: burstWorker.reviewsPerSecond,
    peakQueue: Math.max(...depth),
    queueDepth: depth.slice(0, last + 1),
  },
  race,
};
const file = join(import.meta.dir, "../apps/web/content/benchmarks.json");
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(file);
console.log(JSON.stringify({ ...out, burst: { ...out.burst, queueDepth: `${out.burst.queueDepth.length} samples` } }, null, 1));
