/** Prints one line per intake result file matching the given prefix. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const prefix = process.argv[2] ?? "intake-";
const dir = join(import.meta.dir, "results");
for (const f of readdirSync(dir).filter((f) => f.startsWith(prefix)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
  const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const l = d.latencyMs;
  console.log(`${d.label.padEnd(16)} c=${String(d.concurrency).padStart(3)} ${String(d.throughputRps).padStart(5)} rps  p50=${l.p50}ms p95=${l.p95}ms p99=${l.p99}ms max=${l.max}ms  ${JSON.stringify(d.statuses)}`);
}
