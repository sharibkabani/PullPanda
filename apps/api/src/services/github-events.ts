import { logger, type ReviewJobData } from "@pullpanda/core";
import type { ApiDeps } from "../deps";
import {
  deleteInstallation,
  recordReviewRequest,
  removeRepositories,
  setInstallationSuspended,
  upsertInstallation,
  upsertRepositories,
  type InstallationInput,
  type RepoInput,
} from "./store";

const REVIEW_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

// Minimal shapes of the payload fields we read; GitHub sends far more.
interface InstallationPayload {
  action: string;
  installation: InstallationInput;
  repositories?: RepoInput[];
  repositories_added?: RepoInput[];
  repositories_removed?: RepoInput[];
}
interface PullRequestPayload {
  action: string;
  installation?: { id: number };
  repository: RepoInput & { name: string; owner: { id: number; login: string; type: string } };
  pull_request: { number: number; head: { sha: string } };
}

export type EventResult = { status: number; body: Record<string, unknown> };

export async function handleGitHubEvent(deps: ApiDeps, event: string, payload: unknown): Promise<EventResult> {
  // Signed by GitHub, but still checked: a malformed body must be a 400, not a 500 that GitHub keeps retrying.
  if (typeof payload !== "object" || payload === null) return { status: 400, body: { error: "payload must be an object" } };
  const log = logger.child({ event, action: (payload as { action?: string }).action });

  switch (event) {
    case "ping":
      return { status: 200, body: { ok: true, pong: true } };

    case "installation": {
      const p = payload as InstallationPayload;
      if (!p.installation?.account) return { status: 400, body: { error: "missing installation" } };
      if (p.action === "deleted") {
        await deleteInstallation(deps.db, p.installation.id);
      } else if (p.action === "suspend" || p.action === "unsuspend") {
        await setInstallationSuspended(deps.db, p.installation.id, p.action === "suspend");
      } else {
        await upsertInstallation(deps.db, p.installation);
        await upsertRepositories(deps.db, p.installation.id, p.repositories ?? []);
      }
      log.info({ installationId: p.installation.id }, "installation synced");
      return { status: 200, body: { ok: true } };
    }

    case "installation_repositories": {
      const p = payload as InstallationPayload;
      if (!p.installation?.account) return { status: 400, body: { error: "missing installation" } };
      await upsertInstallation(deps.db, p.installation);
      await upsertRepositories(deps.db, p.installation.id, p.repositories_added ?? []);
      await removeRepositories(deps.db, (p.repositories_removed ?? []).map((r) => r.id));
      return { status: 200, body: { ok: true } };
    }

    case "pull_request": {
      const p = payload as PullRequestPayload;
      if (!REVIEW_ACTIONS.has(p.action)) return { status: 200, body: { ignored: `action ${p.action}` } };
      if (!p.repository?.owner || !p.pull_request?.head?.sha) return { status: 400, body: { error: "missing repository or pull_request" } };
      if (!p.installation) return { status: 400, body: { error: "missing installation" } };

      const installationId = p.installation.id;
      // Self-heal if we missed the installation webhook (e.g. API was down).
      await upsertInstallation(deps.db, { id: installationId, account: p.repository.owner });
      await upsertRepositories(deps.db, installationId, [p.repository]);

      const ref = {
        installationId,
        owner: p.repository.owner.login,
        repo: p.repository.name,
        repositoryId: p.repository.id,
        prNumber: p.pull_request.number,
        headSha: p.pull_request.head.sha,
      };
      const decision = await recordReviewRequest(deps.db, ref);
      if (decision.kind === "duplicate") return { status: 200, body: { duplicate: true } };
      if (decision.kind === "skipped") {
        log.info({ ...ref, reason: decision.reason }, "review skipped");
        return { status: 200, body: { skipped: decision.reason } };
      }
      const job: ReviewJobData = { ...ref, reviewId: decision.reviewId, plan: decision.plan };
      await deps.enqueueReview(job);
      log.info({ ...ref, reviewId: decision.reviewId, requeue: decision.requeue ?? false }, "review queued");
      return { status: 202, body: { queued: true, reviewId: decision.reviewId, ...(decision.requeue ? { requeued: true } : {}) } };
    }

    default:
      return { status: 200, body: { ignored: event } };
  }
}
