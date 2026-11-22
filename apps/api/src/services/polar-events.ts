import { logger } from "@pullpanda/core";
import type { Database } from "@pullpanda/db";
import { applySubscription, subscriptionTargetIsValid } from "./store";

interface SubscriptionData {
  id: string;
  status: string;
  customer_id: string;
  current_period_end: string | null;
  ends_at: string | null;
  created_at: string;
  modified_at: string | null;
  metadata: Record<string, unknown>;
}

/** Applies Polar subscription lifecycle events to the repository they paid for. */
export async function handlePolarEvent(db: Database, event: { type: string; data: unknown }) {
  if (!event.type.startsWith("subscription.")) return { handled: false };
  const sub = event.data as SubscriptionData;
  const repositoryId = Number(sub.metadata?.repositoryId);
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
    logger.warn({ type: event.type, subscriptionId: sub.id }, "subscription without repositoryId metadata");
    return { handled: false };
  }
  if (!(await subscriptionTargetIsValid(db, repositoryId, sub.metadata?.userId))) {
    logger.warn({ type: event.type, subscriptionId: sub.id, repositoryId }, "subscription names a repository its buyer can't manage");
    return { handled: false };
  }
  const applied = await applySubscription(db, {
    id: sub.id,
    status: sub.status,
    customerId: sub.customer_id,
    currentPeriodEnd: sub.current_period_end,
    endsAt: sub.ends_at,
    repositoryId,
    revoked: event.type === "subscription.revoked",
    modifiedAt: new Date(sub.modified_at ?? sub.created_at),
  });
  if (!applied) {
    logger.info({ type: event.type, repositoryId }, "older subscription event ignored");
    return { handled: false, stale: true };
  }
  logger.info({ type: event.type, repositoryId, status: sub.status }, "subscription applied");
  return { handled: true };
}
