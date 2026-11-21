import {
  DEFAULT_CHUNK_OPTIONS,
  estimateCostUsd,
  logger,
  PLANS,
  reviewPullRequest,
  type GitHubClient,
  type ReviewJobData,
  type ReviewModel,
} from "@pullpanda/core";
import { orm, reviews, type Database } from "@pullpanda/db";

const { eq, sql } = orm;

export interface WorkerDeps {
  db: Database;
  model: ReviewModel;
  githubFor(installationId: number): GitHubClient;
}

/** Errors that will fail the same way on retry — don't burn attempts on them. */
export function isPermanent(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  return status === 401 || status === 403 || status === 404 || status === 422;
}

/**
 * Processes one review job. Status transitions are written to Postgres so the
 * dashboard reflects reality, and so a retried job never double-posts a review.
 */
export async function processReviewJob(job: ReviewJobData, attempt: number, deps: WorkerDeps) {
  const log = logger.child({ reviewId: job.reviewId, repo: `${job.owner}/${job.repo}`, pr: job.prNumber });

  const existing = await deps.db.query.reviews.findFirst({ where: eq(reviews.id, job.reviewId) });
  if (!existing) {
    log.warn("review row missing; dropping job");
    return { status: "dropped" as const };
  }
  if (existing.status === "completed" || existing.githubReviewId) {
    log.info("already completed; skipping duplicate job");
    return { status: "duplicate" as const };
  }

  await deps.db
    .update(reviews)
    .set({ status: "running", attempts: sql`${reviews.attempts} + 1` })
    .where(eq(reviews.id, job.reviewId));

  const started = performance.now();
  const outcome = await reviewPullRequest(job, {
    github: deps.githubFor(job.installationId),
    model: deps.model,
    chunk: { ...DEFAULT_CHUNK_OPTIONS, totalTokens: PLANS[job.plan].totalTokens },
  });
  const durationMs = Math.round(performance.now() - started);

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
      costUsd: estimateCostUsd(outcome.usage),
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
