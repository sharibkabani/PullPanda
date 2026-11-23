import { expect, test } from "bun:test";
import { renderComment } from "@pullpanda/core";
import { parseFinding, pickDiffPandaReview } from "../src/findings";

test("parses exactly what the review pipeline renders", () => {
  const body = renderComment({ path: "a.ts", line: 3, severity: "critical", category: "security", title: "SQL injection", body: "Parameterize it.", suggestion: "db.query(sql, [id]);" });
  expect(parseFinding(body)).toEqual({ severity: "critical", title: "SQL injection", category: "security", explanation: "Parameterize it.", suggestion: "db.query(sql, [id]);" });
});

test("a finding without a suggestion and with a longer fence", () => {
  expect(parseFinding(renderComment({ path: "a", line: 1, severity: "warning", category: "bug", title: "Race", body: "Two writers." })).suggestion).toBeNull();
  const fenced = renderComment({ path: "a", line: 1, severity: "nit", category: "style", title: "Doc", body: "x", suggestion: "```ts\ncode\n```" });
  expect(parseFinding(fenced).suggestion).toBe("```ts\ncode\n```");
});

test("picks the newest DiffPanda review", () => {
  const r = pickDiffPandaReview(
    [
      { id: 1, body: "## 🐼 DiffPanda review", submitted_at: "2026-11-01", user: { login: "diffpanda[bot]" } },
      { id: 2, body: "lgtm", submitted_at: "2026-11-03", user: { login: "human" } },
      { id: 3, body: "## 🐼 DiffPanda review", submitted_at: "2026-11-02", user: { login: "diffpanda[bot]" } },
    ],
    "diffpanda[bot]",
  );
  expect(r?.id).toBe(3);
});
