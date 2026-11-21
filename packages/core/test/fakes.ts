import type { ChangedFile, Finding, GitHubClient, PullRequestInfo, ReviewBatchInput, ReviewModel } from "../src";

export class FakeGitHub implements GitHubClient {
  reviews: Parameters<GitHubClient["createReview"]>[0][] = [];
  constructor(
    public pr: PullRequestInfo,
    public files: ChangedFile[],
    public repoFiles: Record<string, string> = {},
  ) {}
  async getPullRequest() { return this.pr; }
  async listPullRequestFiles() { return this.files; }
  async getFileText(_o: string, _r: string, path: string) { return this.repoFiles[path] ?? null; }
  async createReview(input: Parameters<GitHubClient["createReview"]>[0]) {
    this.reviews.push(input);
    return { id: 1000 + this.reviews.length };
  }
}

export class FakeModel implements ReviewModel {
  readonly name = "fake-model";
  calls: ReviewBatchInput[] = [];
  constructor(private respond: (input: ReviewBatchInput) => Finding[]) {}
  async reviewBatch(input: ReviewBatchInput) {
    this.calls.push(input);
    return { summary: `Reviewed ${input.files.length} file(s).`, findings: this.respond(input), usage: { inputTokens: 100, outputTokens: 20 } };
  }
}

export const PATCH = `@@ -1,4 +1,5 @@
 import { db } from "./db";
-export function getUser(id) {
+export async function getUser(id) {
+  const rows = await db.query("SELECT * FROM users WHERE id = " + id);
   return rows[0];
 }`;
