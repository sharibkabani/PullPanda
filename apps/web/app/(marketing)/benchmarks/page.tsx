import { fmt, loadBenchmarks, queueChart, workerChart } from "@/lib/bench";
import { LegalPage } from "../legal";

export const metadata = {
  title: "Benchmarks: PullPanda load test results",
  description: "Webhook intake, queue drain and end-to-end latency for PullPanda, measured with the scripts in bench/.",
};

const ms = (n: number) => `${fmt(n, n < 10 ? 1 : 0)} ms`;
const table = (head: string[] | null, rows: (string | number)[][]) =>
  `<table class="bench-table">${head ? `<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>` : ""}<tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => (head || i ? `<td>${c}</td>` : `<th>${c}</th>`)).join("")}</tr>`)
    .join("")}</tbody></table>`;

/** Every run behind the landing page's charts, with the tables that are the charts' text view. */
export default function Benchmarks() {
  const b = loadBenchmarks();
  const html = `
<p>${b.measuredOn} GitHub and the model were replaced by stand-ins that sleep for realistic times (GitHub calls 60 to 250 ms, the model a log-normal around 2.5 s per batch). Everything else is the production code path: HMAC checks, Postgres, Redis, BullMQ, diff parsing, batching and validation.</p>
<p>Reproduce with <code>bun bench/intake.ts</code> and <code>bun bench/worker.ts</code>; <code>bun bench/report.ts</code> regenerates this page.</p>

<h2>A burst of ${fmt(b.burst.events)} pull requests</h2>
<div class="frame bench-frame"><h3>Reviews waiting during the burst</h3>${queueChart(b.burst)}</div>
${table(null, [
  ["Events queued", fmt(b.burst.events)],
  ["Redeliveries answered as duplicates", fmt(b.burst.duplicates)],
  ["Intake", `${fmt(b.burst.intakeRps)} requests/s for ${fmt(b.burst.intakeSeconds, 1)} s, p99 ${ms(b.burst.intakeP99)}`],
  ["Peak queue", `${fmt(b.burst.peakQueue)} reviews`],
  ["Drained by one worker", `${fmt(b.burst.reviews)} reviews in ${fmt(b.burst.drainSeconds)} s (${fmt(b.burst.reviewsPerSecond)}/s)`],
])}

<h2>Worker throughput</h2>
<div class="frame bench-frame"><h3>Reviews per second from one worker</h3>${workerChart(b.workers)}</div>
${table(
  ["Reviews in flight", "Reviews/s", "Per hour", "p50 per review", "p95 per review"],
  b.workers.map((w) => [fmt(w.concurrency), fmt(w.reviewsPerSecond, 1), fmt(w.reviewsPerHour), ms(w.p50), ms(w.p95)]),
)}
<p>Time per review stays flat at about the stand-ins' own latency, so throughput grows with concurrency. In production the ceiling is the model provider's rate limit, set with <code>WORKER_RATE_PER_MIN</code>.</p>

<h2>Webhook intake</h2>
<p>One API instance with 10 database connections, 20,000 signed events per run, 10% redeliveries.</p>
${table(
  ["Concurrent requests", "Requests/s", "p50", "p95", "p99"],
  b.intake.map((r) => [r.concurrency, fmt(r.rps), ms(r.p50), ms(r.p95), ms(r.p99)]),
)}
<p>Throughput levels off near ${fmt(Math.max(...b.intake.map((r) => r.rps)))} requests/s while latency grows with concurrency: requests wait for the database pool. A pool of 30 lifted one instance to 2,237 requests/s, at which point the single Bun process was the limit.</p>
${table(
  ["API instances (20 connections each)", "Requests/s", "p50", "p99"],
  b.scale.map((r) => [r.instances, fmt(r.rps), ms(r.p50), ms(r.p99)]),
)}
<p>Four instances add nothing over two here because the load generator, the APIs and Postgres share one laptop's ten cores.</p>

<h2>What the load test found</h2>
<p><strong>A quota race.</strong> ${fmt(b.race.requests)} concurrent events for one installation queued ${b.race.before} reviews against a quota of ${b.race.quota}: each request counted usage before any of them inserted. The check and the insert now run in one transaction under an advisory lock on the quota's scope. After the fix: ${b.race.after}.</p>
<p><strong>Suspended installations woke up.</strong> Every pull request event re-saved its installation with <code>suspended = false</code>. Upserts now change only the fields the event knows, and only when they differ, which also stops rewriting unchanged rows on every webhook.</p>
<p><strong>A crash on the live server only.</strong> A route parameter schema made Elysia redefine a property on the params object Bun's native router hands it, so toggling a repository failed in the browser while every in-memory test passed. A test now calls a listening server.</p>`;
  return <LegalPage title="Load test results" html={html} />;
}
