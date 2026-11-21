import { chunkFiles, DEFAULT_CHUNK_OPTIONS, prepareFile, type ChunkOptions, type PreparedFile } from "./chunk";
import {
  CONFIG_PATH,
  DEFAULT_IGNORES,
  isIgnored,
  parseRepoConfig,
  severityRank,
  type RepoConfig,
} from "./config";
import type { GitHubClient, ReviewCommentInput } from "./github";
import type { ReviewModel } from "./llm";
import type { Finding, PullRequestRef, TokenUsage } from "./types";

export type ReviewOutcome =
  | { status: "skipped"; reason: string }
  | { status: "already-posted"; githubReviewId: number }
  | {
      status: "completed";
      githubReviewId: number;
      filesReviewed: number;
      skippedFiles: string[];
      failedFiles: string[];
      findings: Finding[];
      commentsPosted: number;
      usage: TokenUsage;
      model: string;
    };

export interface ReviewDeps {
  github: GitHubClient;
  model: ReviewModel;
  chunk?: ChunkOptions;
  /** Max model calls in flight for one PR. */
  concurrency?: number;
}

const SEVERITY_ICON = { critical: "🔴", warning: "🟠", suggestion: "🔵", nit: "⚪" } as const;

/**
 * Drops findings the model hallucinated (unknown file, line outside the diff),
 * repairs invalid ranges, filters by severity, de-duplicates and caps the count.
 */
export function validateFindings(findings: Finding[], files: PreparedFile[], config: RepoConfig): Finding[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const seen = new Set<string>();
  const valid: Finding[] = [];

  for (const raw of findings) {
    const file = byPath.get(raw.path);
    if (!file || !file.parsed.commentableLines.has(raw.line)) continue;
    if (severityRank[raw.severity] > severityRank[config.minSeverity]) continue;

    const f: Finding = { ...raw };
    if (f.startLine !== undefined) {
      const sameHunk = file.parsed.hunkOf.get(f.startLine) === file.parsed.hunkOf.get(f.line);
      const ok = f.startLine < f.line && file.parsed.commentableLines.has(f.startLine) && sameHunk;
      if (!ok) {
        f.startLine = undefined;
        // A suggestion written for a range is wrong for a single line.
        if (raw.startLine !== raw.line) f.suggestion = undefined;
      }
    }
    const key = `${f.path}:${f.line}:${f.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(f);
  }

  return valid
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.path.localeCompare(b.path) || a.line - b.line)
    .slice(0, config.maxComments);
}

/** Hidden in every review body: lets a retry find the review it already posted for this commit. */
export const reviewMarker = (commitId: string) => `<!-- pullpanda:commit=${commitId} -->`;

export function renderComment(f: Finding): string {
  const parts = [`${SEVERITY_ICON[f.severity]} **${f.title}** · _${f.category}_`, f.body];
  if (f.suggestion !== undefined) {
    // The fence must be longer than any backtick run inside the code, or the suggestion breaks out of it.
    const longest = Math.max(0, ...(f.suggestion.match(/`+/g) ?? []).map((run) => run.length));
    const fence = "`".repeat(Math.max(3, longest + 1));
    parts.push(`${fence}suggestion\n${f.suggestion.replace(/\n$/, "")}\n${fence}`);
  }
  return parts.join("\n\n");
}

export function toReviewComment(f: Finding): ReviewCommentInput {
  return {
    path: f.path,
    line: f.line,
    side: "RIGHT",
    ...(f.startLine !== undefined ? { start_line: f.startLine, start_side: "RIGHT" as const } : {}),
    body: renderComment(f),
  };
}

export function renderSummary(opts: {
  summaries: string[];
  findings: Finding[];
  filesReviewed: number;
  skippedFiles: string[];
  failedFiles?: string[];
  configError?: string;
}): string {
  const counts = opts.findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});
  const tally = (["critical", "warning", "suggestion", "nit"] as const)
    .filter((s) => counts[s])
    .map((s) => `${SEVERITY_ICON[s]} ${counts[s]} ${s}`)
    .join(" · ");

  const lines = ["## 🐼 PullPanda review", "", ...opts.summaries.map((s) => s.trim()).filter(Boolean)];
  lines.push("", `**${opts.filesReviewed} file${opts.filesReviewed === 1 ? "" : "s"} reviewed** — ${tally || "no issues found ✅"}`);
  if (opts.skippedFiles.length) {
    lines.push("", `<details><summary>${opts.skippedFiles.length} file(s) skipped (review budget)</summary>\n\n${opts.skippedFiles.map((p) => `- \`${p}\``).join("\n")}\n</details>`);
  }
  if (opts.failedFiles?.length) {
    lines.push("", `<details><summary>${opts.failedFiles.length} file(s) not reviewed (the model call failed)</summary>\n\n${opts.failedFiles.map((p) => `- \`${p}\``).join("\n")}\n</details>`);
  }
  if (opts.configError) lines.push("", `> ⚠️ ${opts.configError}. Using defaults.`);
  lines.push("", `<sub>Configure with \`${CONFIG_PATH}\` · Powered by PullPanda</sub>`);
  return lines.join("\n");
}

/** Runs fn over items with bounded concurrency; one failure never discards the others' results. */
async function settleLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]!) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/** End-to-end review of one PR commit. Pure orchestration: all I/O goes through `deps`. */
export async function reviewPullRequest(ref: PullRequestRef, deps: ReviewDeps): Promise<ReviewOutcome> {
  const { github, model } = deps;
  const pr = await github.getPullRequest(ref.owner, ref.repo, ref.prNumber);

  if (pr.state !== "open") return { status: "skipped", reason: "pull request is closed" };
  // A newer push will enqueue its own job; don't review a stale commit.
  if (pr.headSha !== ref.headSha) return { status: "skipped", reason: "superseded by a newer commit" };

  const { config, error: configError } = parseRepoConfig(
    await github.getFileText(ref.owner, ref.repo, CONFIG_PATH, ref.headSha),
  );
  if (!config.enabled) return { status: "skipped", reason: `disabled in ${CONFIG_PATH}` };

  // A retry after a crash between posting and recording must not post (or pay for) the review again.
  const marker = reviewMarker(ref.headSha);
  const existing = await github.findReview(ref.owner, ref.repo, ref.prNumber, marker);
  if (existing) return { status: "already-posted", githubReviewId: existing };
  if (pr.draft && !config.reviewDrafts) return { status: "skipped", reason: "draft pull request" };

  const chunkOpts = deps.chunk ?? DEFAULT_CHUNK_OPTIONS;
  const ignores = [...DEFAULT_IGNORES, ...config.ignore];
  const files = (await github.listPullRequestFiles(ref.owner, ref.repo, ref.prNumber))
    .filter((f) => f.status !== "removed" && !isIgnored(f.path, ignores))
    .map((f) => prepareFile(f, chunkOpts.fileTokens))
    .filter((f): f is PreparedFile => f !== null);

  if (files.length === 0) return { status: "skipped", reason: "no reviewable changes" };

  const { batches, skipped } = chunkFiles(files, chunkOpts);
  const settled = await settleLimit(batches, deps.concurrency ?? 3, (batch) =>
    model.reviewBatch({ pr, files: batch, instructions: config.instructions }),
  );
  // Post what succeeded; only when every batch failed is the job worth retrying.
  const ok = settled.flatMap((r, i) => (r.status === "fulfilled" ? [{ result: r.value, batch: batches[i]! }] : []));
  if (ok.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
  const results = ok.map((o) => o.result);
  const failedFiles = settled.flatMap((r, i) => (r.status === "rejected" ? batches[i]!.map((f) => f.path) : []));

  const reviewed = ok.flatMap((o) => o.batch);
  const findings = validateFindings(results.flatMap((r) => r.findings), reviewed, config);
  const usage = results.reduce(
    (acc, r) => ({ inputTokens: acc.inputTokens + r.usage.inputTokens, outputTokens: acc.outputTokens + r.usage.outputTokens }),
    { inputTokens: 0, outputTokens: 0 },
  );

  const body = renderSummary({
    summaries: results.map((r) => r.summary),
    findings,
    filesReviewed: reviewed.length,
    skippedFiles: skipped,
    failedFiles,
    configError,
  });
  const racing = await github.findReview(ref.owner, ref.repo, ref.prNumber, marker);
  if (racing) return { status: "already-posted", githubReviewId: racing };
  const { id } = await github.createReview({
    owner: ref.owner,
    repo: ref.repo,
    prNumber: ref.prNumber,
    commitId: ref.headSha,
    body: `${body}\n\n${marker}`,
    comments: findings.map(toReviewComment),
  });

  return {
    status: "completed",
    githubReviewId: id,
    filesReviewed: reviewed.length,
    skippedFiles: skipped,
    failedFiles,
    findings,
    commentsPosted: findings.length,
    usage,
    model: model.name,
  };
}
