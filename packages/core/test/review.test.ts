import { describe, expect, test } from "bun:test";
import { renderBatchPrompt, renderComment, reviewPullRequest } from "../src";
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
      [{}, { ".diffpanda.yml": "enabled: false" }, "disabled in .diffpanda.yml"],
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
    const gh = new FakeGitHub(pr, files, { ".diffpanda.yml": "instructions: Always use zod for input validation" });
    const model = new FakeModel(() => []);
    await reviewPullRequest(ref, { github: gh, model });
    expect(renderBatchPrompt(model.calls[0]!)).toContain("Always use zod");
  });
});

describe("idempotency and partial failures", () => {
  test("a retry finds the review it already posted and does not call the model again", async () => {
    const gh = new FakeGitHub(pr, files);
    const model = new FakeModel(() => []);
    const first = await reviewPullRequest(ref, { github: gh, model });
    const second = await reviewPullRequest(ref, { github: gh, model });
    expect(first.status).toBe("completed");
    expect(second).toEqual({ status: "already-posted", githubReviewId: 1001 });
    expect(gh.reviews).toHaveLength(1);
    expect(model.calls).toHaveLength(1);
    expect(gh.reviews[0]!.body).toContain("<!-- pullpanda:commit=abc -->");
  });

  test("one failed batch still posts the others and lists the files it missed", async () => {
    const many = [
      ...files,
      { path: "src/orders.ts", status: "modified" as const, additions: 2, deletions: 1, patch: PATCH },
    ];
    const gh = new FakeGitHub(pr, many);
    const model = new FakeModel((input) => {
      if (input.files.some((f) => f.path === "src/orders.ts")) throw new Error("model timeout");
      return [];
    });
    const out = await reviewPullRequest(ref, { github: gh, model, chunk: { batchTokens: 60, fileTokens: 60, totalTokens: 1000 } });
    expect(out.status).toBe("completed");
    if (out.status !== "completed") return;
    expect(out.failedFiles).toEqual(["src/orders.ts"]);
    expect(gh.reviews[0]!.body).toContain("not reviewed (the model call failed)");
  });

  test("when every batch fails the job fails, so the queue retries it", async () => {
    const model = new FakeModel(() => { throw new Error("overloaded"); });
    await expect(reviewPullRequest(ref, { github: new FakeGitHub(pr, files), model })).rejects.toThrow("overloaded");
  });

  test("a suggestion containing backticks keeps its fence", () => {
    const body = renderComment({ path: "a.md", line: 1, severity: "nit", category: "style", title: "Fence", body: "x", suggestion: "```ts\ncode\n```" });
    expect(body).toContain("````suggestion\n```ts\ncode\n```\n````");
  });
});
