import { logger } from "@pullpanda/core";
import type { Database } from "@pullpanda/db";
import { applySubscription } from "./store";

interface SubscriptionData {
  id: string;
  status: string;
  customer_id: string;
  current_period_end: string | null;
  ends_at: string | null;
  metadata: Record<string, unknown>;
}

/** Applies Polar subscription lifecycle events to the repository they paid for. */
export async function handlePolarEvent(db: Database, event: { type: string; data: unknown }) {
  if (!event.type.startsWith("subscription.")) return { handled: false };
  const sub = event.data as SubscriptionData;
  const repositoryId = Number(sub.metadata?.repositoryId);
  if (!Number.isFinite(repositoryId) || repositoryId <= 0) {
    logger.warn({ type: event.type, subscriptionId: sub.id }, "subscription without repositoryId metadata");
    return { handled: false };
  }
  await applySubscription(db, {
    id: sub.id,
    status: sub.status,
    customerId: sub.customer_id,
    currentPeriodEnd: sub.current_period_end,
    endsAt: sub.ends_at,
    repositoryId,
    revoked: event.type === "subscription.revoked",
  });
  logger.info({ type: event.type, repositoryId, status: sub.status }, "subscription applied");
  return { handled: true };
}
