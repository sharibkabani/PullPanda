import { describe, expect, test } from "bun:test";
import { checkEntitlement, chunkFiles, isIgnored, parseRepoConfig, prepareFile, type PreparedFile } from "../src";

const fake = (path: string, tokens: number) => ({ path, tokens }) as PreparedFile;

describe("chunkFiles", () => {
  test("packs files under the batch budget and skips past the total budget", () => {
    const { batches, skipped } = chunkFiles(
      [fake("a", 50), fake("b", 40), fake("c", 30), fake("d", 30), fake("e", 100)],
      { batchTokens: 80, fileTokens: 100, totalTokens: 160 },
    );
    // Largest first: e (100) and a (50) fit the total budget; the rest are skipped.
    expect(batches.map((b) => b.map((f) => f.path))).toEqual([["e"], ["a"]]);
    expect(skipped).toEqual(["b", "c", "d"]);
  });

  test("truncates a single huge file", () => {
    const patch = "@@ -0,0 +1,2000 @@\n" + Array.from({ length: 2000 }, (_, i) => `+line ${i} with some code`).join("\n");
    const f = prepareFile({ path: "big.ts", status: "added", additions: 2000, deletions: 0, patch }, 1000)!;
    expect(f.truncated).toBe(true);
    expect(f.tokens).toBeLessThanOrEqual(1010);
  });

  test("files without a patch (binary) are dropped", () => {
    expect(prepareFile({ path: "a.png", status: "added", additions: 0, deletions: 0 }, 1000)).toBeNull();
  });
});

describe("config", () => {
  test("defaults when missing, errors surfaced when invalid", () => {
    expect(parseRepoConfig(null).config.maxComments).toBe(15);
    const bad = parseRepoConfig("maxComments: 999");
    expect(bad.error).toContain("Invalid");
    expect(bad.config.maxComments).toBe(15);
    expect(parseRepoConfig("minSeverity: warning\nignore: ['docs/**']").config.minSeverity).toBe("warning");
  });

  test("glob ignores match nested and root files", () => {
    expect(isIgnored("package-lock.json", ["**/package-lock.json"])).toBe(true);
    expect(isIgnored("apps/web/package-lock.json", ["**/package-lock.json"])).toBe(true);
    expect(isIgnored("docs/guide.md", ["docs/**"])).toBe(true);
    expect(isIgnored("src/index.ts", ["docs/**"])).toBe(false);
  });
});

describe("entitlements", () => {
  const repo = { private: false, plan: "free" as const, subscriptionStatus: null, currentPeriodEnd: null };
  test("free covers public repos up to the monthly cap", () => {
    expect(checkEntitlement({ repo, reviewsThisMonth: 0 }).allowed).toBe(true);
    expect(checkEntitlement({ repo, reviewsThisMonth: 30 }).allowed).toBe(false);
  });
  test("private repos require an active Pro subscription", () => {
    expect(checkEntitlement({ repo: { ...repo, private: true }, reviewsThisMonth: 0 }).allowed).toBe(false);
    expect(
      checkEntitlement({ repo: { ...repo, private: true, plan: "pro", subscriptionStatus: "active" }, reviewsThisMonth: 0 }).allowed,
    ).toBe(true);
  });
  test("canceled Pro keeps access until period end", () => {
    const pro = { ...repo, private: true, plan: "pro" as const, subscriptionStatus: "canceled" };
    const now = new Date("2026-01-10");
    expect(checkEntitlement({ repo: { ...pro, currentPeriodEnd: new Date("2026-01-31") }, reviewsThisMonth: 0, now }).allowed).toBe(true);
    expect(checkEntitlement({ repo: { ...pro, currentPeriodEnd: new Date("2026-01-01") }, reviewsThisMonth: 0, now }).allowed).toBe(false);
  });
});
