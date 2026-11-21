/**
 * Webhook intake load test. Fires signed pull_request webhooks at a running API and measures what a
 * GitHub delivery sees: latency, status codes and sustained throughput.
 *
 *   bun bench/intake.ts --total=20000 --concurrency=64 --installations=1000 --dup=0.1 --label=c64
 *
 * --dup: share of requests that redeliver an earlier event (new delivery id, same commit), which the API
 * must answer as a duplicate without queueing a second review.
 */
import { signGithubPayload } from "@pullpanda/core";
import { arg, percentiles, round, sarg, writeResult } from "./lib";

// Comma-separated API URLs are used round-robin, standing in for a load balancer in front of N instances.
const APIS = sarg("api", "http://localhost:3101").split(",");
const SECRET = sarg("secret", "bench-secret");
const TOTAL = arg("total", 10_000);
const CONCURRENCY = arg("concurrency", 32);
const INSTALLATIONS = arg("installations", 1000);
const DUP = arg("dup", 0.1);
const LABEL = sarg("label", `c${CONCURRENCY}`);
const RUN = sarg("run", Date.now().toString(36));

function event(i: number) {
  const inst = (i % INSTALLATIONS) + 1;
  const repoId = inst * 10 + (i % 3);
  return JSON.stringify({
    action: i % 4 === 0 ? "synchronize" : "opened",
    installation: { id: inst },
    repository: { id: repoId, name: `repo-${repoId}`, full_name: `org-${inst}/repo-${repoId}`, private: false, owner: { id: inst, login: `org-${inst}`, type: "Organization" } },
    pull_request: { number: (i % 500) + 1, head: { sha: `${RUN}${i.toString(16)}`.padEnd(40, "0") } },
  });
}

const latencies: number[] = [];
const statuses: Record<string, number> = {};
const perSecond: number[] = [];
let sent = 0;
let uniqueSent = 0;
const start = performance.now();

async function one() {
  while (sent < TOTAL) {
    const n = sent++;
    const redeliver = uniqueSent > 0 && Math.random() < DUP;
    const body = event(redeliver ? Math.floor(Math.random() * uniqueSent) : uniqueSent++);
    const t0 = performance.now();
    let status = "error";
    try {
      const res = await fetch(`${APIS[n % APIS.length]}/webhooks/github`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": crypto.randomUUID(),
          "x-hub-signature-256": signGithubPayload(SECRET, body),
        },
        body,
      });
      const json = (await res.json()) as Record<string, unknown>;
      status = `${res.status}${json.duplicate ? " duplicate" : json.skipped ? " skipped" : ""}`;
    } catch {
      status = "network-error";
    }
    const t1 = performance.now();
    latencies.push(t1 - t0);
    statuses[status] = (statuses[status] ?? 0) + 1;
    const sec = Math.floor((t1 - start) / 1000);
    perSecond[sec] = (perSecond[sec] ?? 0) + 1;
    if (n % 5000 === 0 && n) process.stdout.write(`  ${n}/${TOTAL}\n`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, one));
const seconds = (performance.now() - start) / 1000;
const result = {
  label: LABEL,
  total: TOTAL,
  concurrency: CONCURRENCY,
  apiInstances: APIS.length,
  installations: INSTALLATIONS,
  dupRate: DUP,
  uniqueEvents: uniqueSent,
  seconds: round(seconds),
  throughputRps: round(TOTAL / seconds, 0),
  latencyMs: percentiles(latencies),
  statuses,
  perSecond: perSecond.map((n) => n ?? 0),
};
console.log(JSON.stringify({ ...result, perSecond: undefined }, null, 2));
console.log(writeResult(`intake-${LABEL}`, result));
