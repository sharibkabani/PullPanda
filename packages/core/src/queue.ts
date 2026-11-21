import type { PullRequestRef } from "./types";

export const REVIEW_QUEUE = "pr-reviews";

export interface ReviewJobData extends PullRequestRef {
  reviewId: string;
  plan: "free" | "pro";
}

/** Deterministic job id: BullMQ ignores a second add with the same id, which makes enqueueing idempotent. */
export const reviewJobId = (r: Pick<PullRequestRef, "repositoryId" | "prNumber" | "headSha">) =>
  `review-${r.repositoryId}-${r.prNumber}-${r.headSha}`;

export const REVIEW_JOB_OPTIONS = {
  attempts: 4,
  backoff: { type: "exponential" as const, delay: 15_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  // Keep failures around for a week: this is the dead-letter set we inspect and replay.
  removeOnFail: { age: 7 * 24 * 3600 },
};
