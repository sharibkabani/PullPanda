import type { ReviewJobData } from "@pullpanda/core";
import type { Database } from "@pullpanda/db";
import type { Env } from "./env";
import type { GitHubOAuth } from "./services/github-oauth";

export interface Billing {
  createCheckout(input: { repositoryId: number; installationId: number; userId: string; email: string | null; successUrl: string; returnUrl: string }): Promise<{ url: string }>;
  createPortalSession(input: { userId: string; returnUrl: string }): Promise<{ url: string }>;
  /** Throws on bad signature. Returns the parsed event. */
  verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<{ type: string; data: unknown }>;
}

/** Everything the HTTP layer touches, so tests can swap real infra for fakes. */
export interface ApiDeps {
  env: Env;
  db: Database;
  enqueueReview(job: ReviewJobData): Promise<void>;
  /** Short-lived dedupe of GitHub delivery ids. Returns true the first time an id is seen. */
  claimDelivery(id: string): Promise<boolean>;
  oauth: GitHubOAuth | null;
  billing: Billing | null;
  health(): Promise<Record<string, boolean>>;
}
