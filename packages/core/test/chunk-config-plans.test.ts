import { describe, expect, test } from "bun:test";
import { DEFAULT_IGNORES, checkEntitlement, chunkFiles, fileRank, isIgnored, parseRepoConfig, prepareFile, type PreparedFile } from "../src";

const fake = (path: string, tokens: number) => ({ path, tokens }) as PreparedFile;

describe("chunkFiles", () => {
  test("code first, then smaller diffs, within the batch and total budgets", () => {
    const { batches, skipped } = chunkFiles(
      [fake("a.ts", 50), fake("b.ts", 40), fake("c.json", 30), fake("d.ts", 30), fake("e.ts", 100)],
      { batchTokens: 80, fileTokens: 100, totalTokens: 160 },
    );
    // d.ts (30) + b.ts (40) fill a batch, a.ts (50) opens the next; e.ts would pass the total, c.json is data.
    expect(batches.map((b) => b.map((f) => f.path))).toEqual([["d.ts", "b.ts"], ["a.ts", "c.json"]]);
    expect(skipped).toEqual(["e.ts"]);
  });

  test("ranks source code ahead of config and assets", () => {
    expect(fileRank("src/review.ts")).toBeLessThan(fileRank("Dockerfile"));
    expect(fileRank("Dockerfile")).toBeLessThan(fileRank("public/data.json"));
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
    expect(isIgnored("apps/web/public/assets/system.js", DEFAULT_IGNORES)).toBe(true);
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
