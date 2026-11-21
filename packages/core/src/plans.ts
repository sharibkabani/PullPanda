/** Billing rules. Free covers public repos with a monthly cap; Pro is bought per repository. */
export const PLANS = {
  free: { name: "Free", reviewsPerMonth: 30, privateRepos: false, totalTokens: 40_000 },
  pro: { name: "Pro", reviewsPerMonth: 1_000, privateRepos: true, totalTokens: 150_000 },
} as const;
export type PlanId = keyof typeof PLANS;

export type Entitlement = { allowed: true; plan: PlanId } | { allowed: false; plan: PlanId; reason: string };

const ACTIVE = new Set(["active", "trialing"]);

export function effectivePlan(repo: { plan: PlanId; subscriptionStatus: string | null; currentPeriodEnd: Date | null }, now = new Date()): PlanId {
  if (repo.plan !== "pro") return "free";
  if (repo.subscriptionStatus && ACTIVE.has(repo.subscriptionStatus)) return "pro";
  // Canceled subscriptions keep Pro until the paid period ends.
  if (repo.currentPeriodEnd && repo.currentPeriodEnd > now) return "pro";
  return "free";
}

export function checkEntitlement(input: {
  repo: { private: boolean; plan: PlanId; subscriptionStatus: string | null; currentPeriodEnd: Date | null };
  reviewsThisMonth: number;
  now?: Date;
}): Entitlement {
  const plan = effectivePlan(input.repo, input.now);
  const limits = PLANS[plan];
  if (input.repo.private && !limits.privateRepos) {
    return { allowed: false, plan, reason: "Private repositories need PullPanda Pro." };
  }
  if (input.reviewsThisMonth >= limits.reviewsPerMonth) {
    return { allowed: false, plan, reason: `Monthly limit of ${limits.reviewsPerMonth} reviews reached.` };
  }
  return { allowed: true, plan };
}
