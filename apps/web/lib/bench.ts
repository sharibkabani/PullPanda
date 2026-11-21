import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Benchmarks {
  measuredOn: string;
  intake: { concurrency: number; rps: number; p50: number; p95: number; p99: number; requests: number }[];
  scale: { instances: number; rps: number; p50: number; p99: number }[];
  workers: { concurrency: number; reviewsPerSecond: number; reviewsPerHour: number; p50: number; p95: number; jobs: number }[];
  burst: {
    events: number;
    duplicates: number;
    intakeSeconds: number;
    intakeRps: number;
    intakeP99: number;
    reviews: number;
    drainSeconds: number;
    reviewsPerSecond: number;
    peakQueue: number;
    queueDepth: number[];
  };
  race: { before: number; after: number; quota: number; requests: number };
}

/** Results written by bench/report.ts; the charts are drawn from them at build time. */
export function loadBenchmarks(): Benchmarks {
  return JSON.parse(readFileSync(join(process.cwd(), "content/benchmarks.json"), "utf8"));
}

export const fmt = (n: number, digits = 0) => n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });

const W = 600;
const H = 300;
const PAD = { l: 56, r: 16, t: 28, b: 56 };
const plotW = W - PAD.l - PAD.r;
const plotH = H - PAD.t - PAD.b;

function niceMax(v: number, steps = 4) {
  const raw = Math.max(v, 1) / steps; // an all-zero series still gets a 0..4 axis instead of log10(0)
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return { max: step * steps, step };
}

function yAxis(max: number, step: number, y: (v: number) => number) {
  let out = "";
  for (let v = 0; v <= max + 1e-9; v += step) {
    out += `<line class="bc-grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    out += `<text class="bc-tick" x="${PAD.l - 10}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  }
  return out;
}

/** The queue during the burst: one line, its peak labelled, the end of the intake marked. */
export function queueChart(b: Benchmarks["burst"]): string {
  // A line needs two points; pad a single sample so the x scale never divides by zero.
  const pts = b.queueDepth.length >= 2 ? b.queueDepth : [...b.queueDepth, ...b.queueDepth, 0].slice(0, 2);
  const { max, step } = niceMax(Math.max(...pts));
  const x = (i: number) => PAD.l + (i / (pts.length - 1)) * plotW;
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const path = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${path}L${x(pts.length - 1).toFixed(1)},${y(0)}L${x(0)},${y(0)}Z`;
  const peak = Math.max(...pts);
  const peakI = Math.max(0, pts.indexOf(peak));
  const intakeX = x(Math.min(pts.length - 1, b.intakeSeconds));
  let xTicks = "";
  for (let s = 0; s < pts.length; s += 10) xTicks += `<text class="bc-tick" x="${x(s)}" y="${H - PAD.b + 22}" text-anchor="middle">${s} s</text>`;
  const data = JSON.stringify(pts.map((v, i) => ({ x: x(i), y: y(v), label: `${i} s`, value: `${fmt(v)} reviews waiting` })));
  return `<svg class="bench-chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="bq-t" data-points='${data}'>
<title id="bq-t">Reviews waiting in the queue, second by second, during a burst of ${fmt(b.events)} pull request events</title>
${yAxis(max, step, y)}
<line class="bc-ref" x1="${intakeX}" x2="${intakeX}" y1="${PAD.t}" y2="${y(0)}"/>
<text class="bc-note" x="${intakeX + 8}" y="${y(0) - 12}">Webhooks stop at ${fmt(b.intakeSeconds, 1)} s</text>
<path class="bc-area" d="${area}"/>
<path class="bc-line" d="${path}"/>
<circle class="bc-dot" cx="${x(peakI)}" cy="${y(peak)}" r="5"/>
<text class="bc-label" x="${x(peakI) + 12}" y="${y(peak) - 10}">${fmt(peak)} waiting</text>
${xTicks}
<g class="bc-hover" aria-hidden="true"><line class="bc-cross" y1="${PAD.t}" y2="${y(0)}"/><circle class="bc-hdot" r="5"/></g>
</svg>`;
}

/** Reviews per second by worker concurrency: four columns, the value on each cap. */
export function workerChart(rows: Benchmarks["workers"]): string {
  if (rows.length === 0) return "";
  const { max, step } = niceMax(Math.max(...rows.map((r) => r.reviewsPerSecond)));
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const band = plotW / rows.length;
  const bw = Math.min(64, band * 0.5);
  const cols = rows
    .map((r, i) => {
      const cx = PAD.l + band * (i + 0.5);
      const top = y(r.reviewsPerSecond);
      const h = Math.max(2, y(0) - top);
      // a column with rounded data-end, square at the baseline
      const rr = Math.min(4, h / 2);
      const x0 = cx - bw / 2;
      const d = `M${x0},${y(0)}V${top + rr}Q${x0},${top} ${x0 + rr},${top}H${x0 + bw - rr}Q${x0 + bw},${top} ${x0 + bw},${top + rr}V${y(0)}Z`;
      return `<path class="bc-col" d="${d}"/>
<text class="bc-label" x="${cx}" y="${top - 8}" text-anchor="middle">${fmt(r.reviewsPerSecond, r.reviewsPerSecond < 10 ? 1 : 0)}/s</text>
<text class="bc-tick" x="${cx}" y="${H - PAD.b + 22}" text-anchor="middle">${fmt(r.concurrency)}</text>`;
    })
    .join("\n");
  const data = JSON.stringify(
    rows.map((r, i) => ({
      x: PAD.l + band * (i + 0.5),
      y: y(r.reviewsPerSecond),
      label: `${fmt(r.concurrency)} reviews at once`,
      value: `${fmt(r.reviewsPerSecond, 1)} reviews/s · ${fmt(r.reviewsPerHour)} an hour`,
    })),
  );
  return `<svg class="bench-chart" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="bw-t" data-points='${data}' data-kind="columns">
<title id="bw-t">Reviews finished per second by one worker process, at ${rows.map((r) => r.concurrency).join(", ")} reviews at once</title>
${yAxis(max, step, y)}
${cols}
<text class="bc-axis" x="${PAD.l + plotW / 2}" y="${H - 6}" text-anchor="middle">Reviews in flight in one worker</text>
</svg>`;
}
