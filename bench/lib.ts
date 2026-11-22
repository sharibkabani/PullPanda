/** Shared helpers for the load tests: percentiles and result files. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function percentiles(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  const at = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! : 0);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  return { count: s.length, mean: round(mean), p50: round(at(50)), p90: round(at(90)), p95: round(at(95)), p99: round(at(99)), max: round(s.at(-1) ?? 0) };
}

export const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function writeResult(name: string, data: unknown) {
  const dir = join(import.meta.dir, "results");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

export const arg = (name: string, fallback: number) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : fallback;
};
export const sarg = (name: string, fallback: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1]! : fallback;
};
