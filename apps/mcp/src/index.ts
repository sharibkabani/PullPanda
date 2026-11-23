#!/usr/bin/env bun
/**
 * DiffPanda MCP server: lets an MCP client (Claude Code, Claude Desktop) read DiffPanda's findings on a pull
 * request and mark them resolved once fixed. It reads the review DiffPanda posted on GitHub, so it works for
 * any repository the token can see, with no access to the DiffPanda database.
 *
 *   claude mcp add diffpanda -- bun /path/to/apps/mcp/src/index.ts
 *
 * Auth: GITHUB_TOKEN, else the GitHub CLI's login (`gh auth token`).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Octokit } from "@octokit/rest";
import { z } from "zod";
import { parseFinding, pickDiffPandaReview, splitRepo } from "./findings";

function githubToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const gh = Bun.spawnSync(["gh", "auth", "token"]);
  const token = gh.stdout.toString().trim();
  if (!token) throw new Error("Set GITHUB_TOKEN or log in with `gh auth login`.");
  return token;
}

const octokit = new Octokit({ auth: githubToken(), userAgent: "diffpanda-mcp" });
const BOT = process.env.DIFFPANDA_BOT_LOGIN ?? "diffpanda[bot]";

interface Thread {
  id: string;
  isResolved: boolean;
  comments: { nodes: { databaseId: number }[] };
}

async function reviewThreads(owner: string, repo: string, pr: number): Promise<Map<number, Thread>> {
  const res = await octokit.graphql<{ repository: { pullRequest: { reviewThreads: { nodes: Thread[] } } } }>(
    `query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          reviewThreads(first: 100) { nodes { id isResolved comments(first: 1) { nodes { databaseId } } } }
        }
      }
    }`,
    { owner, repo, pr },
  );
  const byComment = new Map<number, Thread>();
  for (const t of res.repository.pullRequest.reviewThreads.nodes) {
    const first = t.comments.nodes[0];
    if (first) byComment.set(first.databaseId, t);
  }
  return byComment;
}

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });

const server = new McpServer({ name: "diffpanda", version: "0.1.0" });

server.registerTool(
  "get_review_findings",
  {
    title: "Get DiffPanda findings",
    description:
      "Returns the findings from DiffPanda's latest review of a pull request: file, line, severity, the problem and a suggested fix, plus whether each one is already resolved. Use it before fixing what DiffPanda flagged.",
    inputSchema: {
      repo: z.string().describe("owner/name, for example acme/checkout-api"),
      pr: z.number().int().positive().describe("Pull request number"),
      include_resolved: z.boolean().optional().describe("Also return findings already resolved (default false)"),
    },
  },
  async ({ repo, pr, include_resolved }) => {
    const { owner, name } = splitRepo(repo);
    const reviews = await octokit.paginate(octokit.pulls.listReviews, { owner, repo: name, pull_number: pr, per_page: 100 });
    const review = pickDiffPandaReview(reviews, BOT);
    if (!review) return text(`DiffPanda hasn't reviewed ${repo}#${pr} yet.`);

    const [comments, threads] = await Promise.all([
      octokit.paginate(octokit.pulls.listCommentsForReview, { owner, repo: name, pull_number: pr, review_id: review.id, per_page: 100 }),
      reviewThreads(owner, name, pr),
    ]);
    const findings = comments
      .map((c) => ({
        comment_id: c.id,
        path: c.path,
        line: c.line ?? c.original_line,
        start_line: c.start_line ?? undefined,
        resolved: threads.get(c.id)?.isResolved ?? false,
        ...parseFinding(c.body),
      }))
      .filter((f) => include_resolved || !f.resolved);

    return text({
      repo,
      pr,
      reviewed_commit: review.commit_id,
      review_url: review.html_url,
      open_findings: findings.filter((f) => !f.resolved).length,
      findings,
    });
  },
);

server.registerTool(
  "resolve_finding",
  {
    title: "Resolve a DiffPanda finding",
    description:
      "Marks one DiffPanda finding as fixed: replies on its review thread with a short note (say what changed and in which commit) and resolves the thread. Call it after the fix is pushed.",
    inputSchema: {
      repo: z.string().describe("owner/name"),
      pr: z.number().int().positive(),
      comment_id: z.number().int().positive().describe("comment_id from get_review_findings"),
      note: z.string().min(1).max(2000).describe("What was fixed, for example 'Fixed in 3f2a1c9: parameterized the query.'"),
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  async ({ repo, pr, comment_id, note }) => {
    const { owner, name } = splitRepo(repo);
    const thread = (await reviewThreads(owner, name, pr)).get(comment_id);
    if (!thread) return text(`No DiffPanda thread starts with comment ${comment_id} on ${repo}#${pr}.`);
    if (thread.isResolved) return text(`Already resolved.`);
    await octokit.pulls.createReplyForReviewComment({ owner, repo: name, pull_number: pr, comment_id, body: note });
    await octokit.graphql(`mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { isResolved } } }`, {
      id: thread.id,
    });
    return text(`Resolved: replied "${note.slice(0, 80)}" and closed the thread.`);
  },
);

await server.connect(new StdioServerTransport());
