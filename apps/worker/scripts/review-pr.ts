/**
 * Runs the PullPanda review pipeline once against a real pull request, outside the queue.
 * Uses a GitHub token (GITHUB_TOKEN, e.g. `gh auth token`) instead of the GitHub App, so the review is
 * posted as that user.
 *
 *   GITHUB_TOKEN=$(gh auth token) bun apps/worker/scripts/review-pr.ts owner/repo#1 --plan     # no model call
 *   GITHUB_TOKEN=$(gh auth token) OPENAI_API_KEY=... bun apps/worker/scripts/review-pr.ts owner/repo#1 --dry-run
 *   GITHUB_TOKEN=$(gh auth token) OPENAI_API_KEY=... bun apps/worker/scripts/review-pr.ts owner/repo#1        # posts
 */
import {
  CONFIG_PATH,
  DEFAULT_CHUNK_OPTIONS,
  DEFAULT_IGNORES,
  OctokitGitHubClient,
  OpenAIReviewModel,
  quietLog,
  PLANS,
  chunkFiles,
  isIgnored,
  parseRepoConfig,
  prepareFile,
  reviewPullRequest,
  type GitHubClient,
  type PreparedFile,
} from "@pullpanda/core";
import { Octokit } from "@octokit/rest";

const target = process.argv[2];
const match = target && /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(target);
if (!match) throw new Error("usage: review-pr.ts owner/repo#number [--plan | --dry-run]");
const [, owner, repo, num] = match as unknown as [string, string, string, string];
const plan = process.argv.includes("--plan");
const dryRun = process.argv.includes("--dry-run");
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("set GITHUB_TOKEN (for example: GITHUB_TOKEN=$(gh auth token))");

const octokit = new Octokit({ auth: token, userAgent: "PullPanda", log: quietLog });
const real = new OctokitGitHubClient(octokit);
const prNumber = Number(num);
const pr = await real.getPullRequest(owner, repo, prNumber);
const { data: repoInfo } = await octokit.repos.get({ owner, repo });
const tier = repoInfo.private ? "pro" : "free";
const chunk = { ...DEFAULT_CHUNK_OPTIONS, totalTokens: PLANS[tier].totalTokens };

if (plan) {
  const { config, error } = parseRepoConfig(await real.getFileText(owner, repo, CONFIG_PATH, pr.headSha));
  const all = await real.listPullRequestFiles(owner, repo, prNumber);
  const ignored = all.filter((f) => f.status === "removed" || isIgnored(f.path, [...DEFAULT_IGNORES, ...config.ignore]));
  const prepared = all
    .filter((f) => !ignored.includes(f))
    .map((f) => prepareFile(f, chunk.fileTokens))
    .filter((f): f is PreparedFile => f !== null);
  const { batches, skipped } = chunkFiles(prepared, chunk);
  console.log(`${owner}/${repo}#${prNumber} "${pr.title}" @ ${pr.headSha.slice(0, 7)} (${tier} plan budget ${chunk.totalTokens} tokens)`);
  console.log(`config: ${error ?? `ok (minSeverity ${config.minSeverity}, ${config.ignore.length} extra ignores)`}`);
  console.log(`files: ${all.length} changed, ${ignored.length} ignored or removed, ${all.length - ignored.length - prepared.length} without a diff, ${prepared.length} reviewable`);
  batches.forEach((b, i) => console.log(`batch ${i + 1}: ${b.length} files, ~${b.reduce((a, f) => a + f.tokens, 0)} tokens  (${b.slice(0, 4).map((f) => f.path).join(", ")}${b.length > 4 ? ", ..." : ""})`));
  console.log(`skipped past budget: ${skipped.length}`);
  process.exit(0);
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("set OPENAI_API_KEY to run the model");
const github: GitHubClient = dryRun
  ? {
      getPullRequest: real.getPullRequest.bind(real),
      listPullRequestFiles: real.listPullRequestFiles.bind(real),
      getFileText: real.getFileText.bind(real),
      async createReview(input) {
        console.log(`\n--- review body ---\n${input.body}\n`);
        for (const c of input.comments) console.log(`--- ${c.path}:${c.start_line ? `${c.start_line}-` : ""}${c.line}\n${c.body}\n`);
        return { id: 0 };
      },
    }
  : real;

const started = performance.now();
const outcome = await reviewPullRequest(
  { installationId: 0, owner, repo, repositoryId: repoInfo.id, prNumber, headSha: pr.headSha },
  { github, model: new OpenAIReviewModel({ apiKey, model: process.env.OPENAI_MODEL }), chunk },
);
console.log(JSON.stringify({ ...outcome, findings: undefined, seconds: Math.round((performance.now() - started) / 100) / 10 }, null, 2));
