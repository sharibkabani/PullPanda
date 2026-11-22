import { describe, expect, test } from "bun:test";
import { parsePatch } from "../src";
import { PATCH } from "./fakes";

describe("parsePatch", () => {
  test("maps added and context lines to new-file line numbers", () => {
    const p = parsePatch(PATCH);
    expect([...p.addedLines]).toEqual([2, 3]);
    expect([...p.commentableLines].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  test("removed lines are not commentable and carry no number", () => {
    const p = parsePatch(PATCH);
    expect(p.annotated).toContain("      - export function getUser(id) {");
    expect(p.annotated).toContain("    3 +   const rows");
  });

  test("tracks hunks separately", () => {
    const p = parsePatch("@@ -1,1 +1,1 @@\n-a\n+b\n@@ -10,1 +10,2 @@\n c\n+d\n");
    expect(p.hunkOf.get(1)).toBe(0);
    expect(p.hunkOf.get(11)).toBe(1);
    expect(p.commentableLines.has(12)).toBe(false);
  });

  test("ignores 'no newline' markers", () => {
    const p = parsePatch("@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file");
    expect([...p.commentableLines]).toEqual([1]);
  });
});
