import {
  DEFAULT_CHUNK_OPTIONS,
  estimateCostUsd,
  modelPrices,
  logger,
  PLANS,
  reviewPullRequest,
  type GitHubClient,
  type ReviewJobData,
  type ReviewModel,
} from "@pullpanda/core";
import { orm, reviews, type Database } from "@pullpanda/db";

const { and, eq, inArray, isNull, sql } = orm;

export interface WorkerDeps {
  db: Database;
  model: ReviewModel;
  githubFor(installationId: number): GitHubClient;
}

/** GitHub answers rate limits (primary and secondary) with 403 too; those clear up, so they retry. */
function isRateLimited(err: unknown): boolean {
  const e = err as { message?: string; response?: { headers?: Record<string, string | undefined> } };
  const h = e.response?.headers ?? {};
  return h["x-ratelimit-remaining"] === "0" || h["retry-after"] !== undefined || /rate limit/i.test(e.message ?? "");
}

/** Errors that will fail the same way on retry — don't burn attempts on them. */
export function isPermanent(err: unknown): boolean {
  if ((err as { permanent?: boolean }).permanent) return true; // e.g. the model refused the batch
  const status = (err as { status?: number }).status;
  if (status === 403 && isRateLimited(err)) return false;
  return status === 401 || status === 403 || status === 404 || status === 422;
}

/**
 * Processes one review job. Status transitions are written to Postgres so the
 * dashboard reflects reality, and so a retried job never double-posts a review.
 */
export async function processReviewJob(job: ReviewJobData, attempt: number, deps: WorkerDeps) {
  const log = logger.child({ reviewId: job.reviewId, repo: `${job.owner}/${job.repo}`, pr: job.prNumber });

  // Claim the row in one statement: a stalled job redelivered to a second worker can't also pass this.
  const [claimed] = await deps.db
    .update(reviews)
    .set({ status: "running", attempts: sql`${reviews.attempts} + 1` })
    .where(and(eq(reviews.id, job.reviewId), isNull(reviews.githubReviewId), inArray(reviews.status, ["queued", "running", "failed"])))
    .returning({ id: reviews.id });
  if (!claimed) {
    const exists = await deps.db.query.reviews.findFirst({ where: eq(reviews.id, job.reviewId), columns: { id: true } });
    log.info(exists ? "already completed; skipping duplicate job" : "review row missing; dropping job");
    return { status: exists ? ("duplicate" as const) : ("dropped" as const) };
  }

  const started = performance.now();
  const outcome = await reviewPullRequest(job, {
    github: deps.githubFor(job.installationId),
    model: deps.model,
    chunk: { ...DEFAULT_CHUNK_OPTIONS, totalTokens: PLANS[job.plan].totalTokens },
  });
  const durationMs = Math.round(performance.now() - started);

  if (outcome.status === "already-posted") {
    // An earlier attempt posted the review and then failed to record it: record it now.
    await deps.db
      .update(reviews)
      .set({ status: "completed", githubReviewId: outcome.githubReviewId, durationMs, completedAt: new Date() })
      .where(eq(reviews.id, job.reviewId));
    log.info({ githubReviewId: outcome.githubReviewId }, "review was already posted; recorded it");
    return outcome;
  }

  if (outcome.status === "skipped") {
    await deps.db
      .update(reviews)
      .set({ status: "skipped", skipReason: outcome.reason, durationMs, completedAt: new Date() })
      .where(eq(reviews.id, job.reviewId));
    log.info({ reason: outcome.reason, attempt }, "review skipped");
    return outcome;
  }

  await deps.db
    .update(reviews)
    .set({
      status: "completed",
      githubReviewId: outcome.githubReviewId,
      filesReviewed: outcome.filesReviewed,
      commentsPosted: outcome.commentsPosted,
      findings: outcome.findings,
      model: outcome.model,
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
      costUsd: estimateCostUsd(outcome.usage, modelPrices(outcome.model)),
      durationMs,
      error: null,
      completedAt: new Date(),
    })
    .where(eq(reviews.id, job.reviewId));
  log.info({ durationMs, comments: outcome.commentsPosted, ...outcome.usage }, "review posted");
  return outcome;
}

export async function markFailed(db: Database, reviewId: string, err: unknown) {
  await db
    .update(reviews)
    .set({ status: "failed", error: String((err as Error)?.message ?? err).slice(0, 1000), completedAt: new Date() })
    .where(eq(reviews.id, reviewId));
}
