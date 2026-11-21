import { describe, expect, test } from "bun:test";
import { reviewPullRequest, renderBatchPrompt } from "../src";
import { FakeGitHub, FakeModel, PATCH } from "./fakes";

const ref = { installationId: 1, owner: "acme", repo: "api", repositoryId: 42, prNumber: 7, headSha: "abc" };
const pr = { title: "Load users", body: "Adds getUser", draft: false, state: "open" as "open" | "closed", headSha: "abc", baseRef: "main" };
const files = [
  { path: "src/users.ts", status: "modified" as const, additions: 2, deletions: 1, patch: PATCH },
  { path: "package-lock.json", status: "modified" as const, additions: 900, deletions: 900, patch: "@@ -1 +1 @@\n-a\n+b" },
];

describe("reviewPullRequest", () => {
  test("posts one review with validated inline comments", async () => {
    const gh = new FakeGitHub(pr, files);
    const model = new FakeModel(() => [
      { path: "src/users.ts", line: 3, severity: "critical", category: "security", title: "SQL injection", body: "Use a parameterized query.", suggestion: '  const rows = await db.query("SELECT * FROM users WHERE id = $1", [id]);' },
      { path: "src/users.ts", line: 99, severity: "warning", category: "bug", title: "Hallucinated line", body: "x" },
      { path: "nope.ts", line: 1, severity: "warning", category: "bug", title: "Unknown file", body: "x" },
      { path: "src/users.ts", line: 4, severity: "nit", category: "style", title: "Below min severity", body: "x" },
    ]);

    const out = await reviewPullRequest(ref, { github: gh, model });
    expect(out.status).toBe("completed");
    if (out.status !== "completed") return;
    expect(out.commentsPosted).toBe(1);
    expect(out.usage).toEqual({ inputTokens: 100, outputTokens: 20 });

    // lockfile never reaches the model
    expect(model.calls[0]!.files.map((f) => f.path)).toEqual(["src/users.ts"]);

    const posted = gh.reviews[0]!;
    expect(posted.commitId).toBe("abc");
    expect(posted.comments).toHaveLength(1);
    expect(posted.comments[0]).toMatchObject({ path: "src/users.ts", line: 3, side: "RIGHT" });
    expect(posted.comments[0]!.body).toContain("```suggestion");
    expect(posted.body).toContain("1 file reviewed");
  });

  test("skips drafts, closed PRs, stale commits and repos that opted out", async () => {
    const model = new FakeModel(() => []);
    const cases: [Partial<Omit<typeof pr, "state">> & { state?: "open" | "closed" }, Record<string, string>, string][] = [
      [{ draft: true }, {}, "draft pull request"],
      [{ state: "closed" }, {}, "pull request is closed"],
      [{ headSha: "newer" }, {}, "superseded by a newer commit"],
      [{}, { ".pullpanda.yml": "enabled: false" }, "disabled in .pullpanda.yml"],
    ];
    for (const [over, repoFiles, reason] of cases) {
      const out = await reviewPullRequest(ref, { github: new FakeGitHub({ ...pr, ...over }, files, repoFiles), model });
      expect(out).toEqual({ status: "skipped", reason });
    }
    expect(model.calls).toHaveLength(0);
  });

  test("drops an invalid range but keeps the single-line comment", async () => {
    const gh = new FakeGitHub(pr, files);
    const model = new FakeModel(() => [
      { path: "src/users.ts", line: 3, startLine: 9, severity: "warning", category: "bug", title: "Bad range", body: "x", suggestion: "y" },
    ]);
    await reviewPullRequest(ref, { github: gh, model });
    const c = gh.reviews[0]!.comments[0]!;
    expect(c.start_line).toBeUndefined();
    expect(c.body).not.toContain("```suggestion");
  });

  test("repo instructions reach the prompt", async () => {
    const gh = new FakeGitHub(pr, files, { ".pullpanda.yml": "instructions: Always use zod for input validation" });
    const model = new FakeModel(() => []);
    await reviewPullRequest(ref, { github: gh, model });
    expect(renderBatchPrompt(model.calls[0]!)).toContain("Always use zod");
  });
});
