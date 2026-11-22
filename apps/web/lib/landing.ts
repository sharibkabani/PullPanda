import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fmt, loadBenchmarks, queueChart, workerChart } from "./bench";
import { DASHBOARD_URL, INSTALL_URL } from "./site";

export interface LandingParts {
  header: string;
  main: string;
  footer: string;
}

function inner(html: string, tag: string): string {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*)</${tag}>`).exec(html);
  if (!match?.[1]) throw new Error(`landing.html has no <${tag}>`);
  return match[1];
}

/**
 * Reads the landing markup at build time. The kit's scripts mutate this DOM (loops, moments, the phone
 * sheet), so React injects it untouched instead of rendering it as components it would later reconcile.
 */
export function loadLanding(): LandingParts {
  const b = loadBenchmarks();
  // Figures and charts come from content/benchmarks.json (bench/report.ts), so the copy can't drift from them.
  const fill: Record<string, string> = {
    INSTALL_URL,
    DASHBOARD_URL,
    B_EVENTS: fmt(b.burst.events),
    B_INTAKE_S: fmt(b.burst.intakeSeconds, 1),
    B_INTAKE_P99: fmt(b.burst.intakeP99),
    B_DRAIN_S: fmt(b.burst.drainSeconds),
    BENCH_QUEUE_SVG: queueChart(b.burst),
    BENCH_WORKER_SVG: workerChart(b.workers),
  };
  const raw = readFileSync(join(process.cwd(), "content/landing.html"), "utf8").replace(/\{\{(\w+)\}\}/g, (m, k: string) => {
    if (!(k in fill)) throw new Error(`landing.html: unknown placeholder ${m}`);
    return fill[k]!;
  });
  return { header: inner(raw, "header"), main: inner(raw, "main"), footer: inner(raw, "footer") };
}
