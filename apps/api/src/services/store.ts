import { checkEntitlement, effectivePlan, type PlanId } from "@pullpanda/core";
import {
  installations,
  orm,
  processedEvents,
  repositories,
  reviews,
  userInstallations,
  users,
  type Database,
} from "@pullpanda/db";

const { and, eq, gte, inArray, ne, sql, desc } = orm;
type SQL = ReturnType<typeof sql>;

export interface InstallationInput {
  id: number;
  account: { id: number; login: string; type: string };
  suspended?: boolean;
}
export interface RepoInput {
  id: number;
  full_name: string;
  private: boolean;
}

/**
 * Inserts or refreshes an installation. The update only fires when a field really changed, so the hot
 * webhook path doesn't rewrite (and WAL-log) an identical row on every event. `suspended` is only touched
 * when the caller knows it: a pull_request event must never un-suspend an installation.
 */
export async function upsertInstallation(db: Database, inst: InstallationInput) {
  const set: { accountLogin: SQL; suspended?: SQL } = { accountLogin: sql`excluded.account_login` };
  let changed = sql`${installations.accountLogin} is distinct from excluded.account_login`;
  if (inst.suspended !== undefined) {
    set.suspended = sql`excluded.suspended`;
    changed = sql`${changed} or ${installations.suspended} is distinct from excluded.suspended`;
  }
  await db
    .insert(installations)
    .values({
      id: inst.id,
      accountId: inst.account.id,
      accountLogin: inst.account.login,
      accountType: inst.account.type,
      suspended: inst.suspended ?? false,
    })
    .onConflictDoUpdate({ target: installations.id, set, setWhere: changed });
}

export async function upsertRepositories(db: Database, installationId: number, repos: RepoInput[]) {
  if (repos.length === 0) return;
  await db
    .insert(repositories)
    .values(repos.map((r) => ({ id: r.id, installationId, fullName: r.full_name, private: r.private })))
    .onConflictDoUpdate({
      target: repositories.id,
      set: { fullName: sql`excluded.full_name`, private: sql`excluded.private`, installationId: sql`excluded.installation_id` },
      setWhere: sql`(${repositories.fullName}, ${repositories.private}, ${repositories.installationId}) is distinct from (excluded.full_name, excluded.private, excluded.installation_id)`,
    });
}

export async function removeRepositories(db: Database, ids: number[]) {
  if (ids.length) await db.delete(repositories).where(inArray(repositories.id, ids));
}

export async function deleteInstallation(db: Database, id: number) {
  await db.delete(installations).where(eq(installations.id, id));
}

export async function setInstallationSuspended(db: Database, id: number, suspended: boolean) {
  await db.update(installations).set({ suspended }).where(eq(installations.id, id));
}

/** Monthly usage that counts against the given plan's quota. */
export async function reviewsThisMonth(db: Pick<Database, "select">, repo: { id: number; installationId: number }, plan: PlanId) {
  const scope = plan === "pro" ? eq(reviews.repositoryId, repo.id) : eq(reviews.installationId, repo.installationId);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(reviews)
    .where(and(scope, eq(reviews.plan, plan), ne(reviews.status, "skipped"), gte(reviews.createdAt, sql`date_trunc('month', now())`)));
  return row?.n ?? 0;
}

export type EnqueueDecision =
  | { kind: "enqueue"; reviewId: string; plan: PlanId }
  | { kind: "duplicate" }
  | { kind: "skipped"; reason: string };

/**
 * Decides whether a PR commit gets reviewed and records the attempt. The unique
 * (repo, pr, sha) index makes this idempotent under webhook redelivery.
 *
 * The quota check and the insert run in one transaction holding an advisory lock on the quota's scope
 * (the installation on Free, the repository on Pro). Without it, concurrent webhooks all count the same
 * usage and all insert: the load test pushed 60 reviews through a 30-review quota.
 */
export async function recordReviewRequest(
  db: Database,
  input: { repositoryId: number; installationId: number; prNumber: number; headSha: string },
): Promise<EnqueueDecision> {
  // One round trip for both rows: this runs on every webhook.
  const [found] = await db
    .select({ repo: repositories, suspended: installations.suspended })
    .from(repositories)
    .leftJoin(installations, eq(installations.id, repositories.installationId))
    .where(eq(repositories.id, input.repositoryId));
  if (!found) return { kind: "skipped", reason: "repository not installed" };
  const { repo } = found;
  const plan = effectivePlan(repo);

  return db.transaction(async (tx) => {
    let skipReason: string | null = null;
    if (found.suspended) skipReason = "installation suspended";
    else if (!repo.enabled) skipReason = "repository disabled in dashboard";
    else {
      const scope = plan === "pro" ? `quota:repo:${repo.id}` : `quota:installation:${repo.installationId}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`);
      const ent = checkEntitlement({ repo, reviewsThisMonth: await reviewsThisMonth(tx, repo, plan) });
      if (!ent.allowed) skipReason = ent.reason;
    }

    const [row] = await tx
      .insert(reviews)
      .values({
        repositoryId: input.repositoryId,
        installationId: input.installationId,
        prNumber: input.prNumber,
        headSha: input.headSha,
        plan,
        status: skipReason ? "skipped" : "queued",
        skipReason,
      })
      .onConflictDoNothing()
      .returning({ id: reviews.id });

    if (!row) return { kind: "duplicate" } as const;
    if (skipReason) return { kind: "skipped", reason: skipReason } as const;
    return { kind: "enqueue", reviewId: row.id, plan } as const;
  });
}

/** Returns false if this event id was already processed. */
export async function claimEvent(db: Database, source: string, id: string): Promise<boolean> {
  const rows = await db.insert(processedEvents).values({ id: `${source}:${id}`, source }).onConflictDoNothing().returning();
  return rows.length > 0;
}

export async function upsertUser(
  db: Database,
  u: { id: number; login: string; name: string | null; email: string | null; avatar_url: string },
) {
  const [row] = await db
    .insert(users)
    .values({ githubId: u.id, login: u.login, name: u.name, email: u.email, avatarUrl: u.avatar_url })
    .onConflictDoUpdate({
      target: users.githubId,
      set: { login: u.login, name: u.name, email: u.email, avatarUrl: u.avatar_url },
    })
    .returning();
  return row!;
}

export async function linkUserInstallations(db: Database, userId: string, installationIds: number[]) {
  await db.delete(userInstallations).where(eq(userInstallations.userId, userId));
  if (installationIds.length) {
    await db.insert(userInstallations).values(installationIds.map((installationId) => ({ userId, installationId })));
  }
}

export async function userInstallationIds(db: Database, userId: string): Promise<number[]> {
  const rows = await db.select({ id: userInstallations.installationId }).from(userInstallations).where(eq(userInstallations.userId, userId));
  return rows.map((r) => r.id);
}

export async function userCanAccessRepo(db: Database, userId: string, repositoryId: number) {
  const [row] = await db
    .select({ repo: repositories })
    .from(repositories)
    .innerJoin(userInstallations, eq(userInstallations.installationId, repositories.installationId))
    .where(and(eq(userInstallations.userId, userId), eq(repositories.id, repositoryId)));
  return row?.repo ?? null;
}

export async function dashboardData(db: Database, userId: string) {
  const ids = await userInstallationIds(db, userId);
  if (ids.length === 0) return { installations: [], repositories: [], reviews: [], stats: emptyStats() };

  const [insts, repos, recent, statsRow] = await Promise.all([
    db.select().from(installations).where(inArray(installations.id, ids)),
    db.select().from(repositories).where(inArray(repositories.installationId, ids)).orderBy(repositories.fullName),
    db
      .select({
        id: reviews.id,
        repository: repositories.fullName,
        prNumber: reviews.prNumber,
        headSha: reviews.headSha,
        status: reviews.status,
        skipReason: reviews.skipReason,
        commentsPosted: reviews.commentsPosted,
        filesReviewed: reviews.filesReviewed,
        durationMs: reviews.durationMs,
        costUsd: reviews.costUsd,
        error: reviews.error,
        createdAt: reviews.createdAt,
      })
      .from(reviews)
      .innerJoin(repositories, eq(repositories.id, reviews.repositoryId))
      .where(inArray(reviews.installationId, ids))
      .orderBy(desc(reviews.createdAt))
      .limit(50),
    db
      .select({
        total: sql<number>`count(*) filter (where ${reviews.status} = 'completed')::int`,
        comments: sql<number>`coalesce(sum(${reviews.commentsPosted}), 0)::int`,
        p50: sql<number | null>`percentile_cont(0.5) within group (order by ${reviews.durationMs}) filter (where ${reviews.status} = 'completed')`,
        p95: sql<number | null>`percentile_cont(0.95) within group (order by ${reviews.durationMs}) filter (where ${reviews.status} = 'completed')`,
        failed: sql<number>`count(*) filter (where ${reviews.status} = 'failed')::int`,
        costUsd: sql<number>`coalesce(sum(${reviews.costUsd}), 0)::float`,
      })
      .from(reviews)
      .where(and(inArray(reviews.installationId, ids), gte(reviews.createdAt, sql`now() - interval '30 days'`))),
  ]);

  return {
    installations: insts,
    repositories: repos.map((r) => ({ ...r, effectivePlan: effectivePlan(r) })),
    reviews: recent,
    stats: statsRow[0] ?? emptyStats(),
  };
}

const emptyStats = () => ({ total: 0, comments: 0, p50: null, p95: null, failed: 0, costUsd: 0 });

export async function setRepositoryEnabled(db: Database, id: number, enabled: boolean) {
  await db.update(repositories).set({ enabled }).where(eq(repositories.id, id));
}

export async function applySubscription(
  db: Database,
  sub: {
    id: string;
    status: string;
    customerId: string;
    currentPeriodEnd: string | null;
    endsAt: string | null;
    repositoryId: number;
    revoked: boolean;
  },
) {
  const periodEnd = sub.endsAt ?? sub.currentPeriodEnd;
  await db
    .update(repositories)
    .set({
      plan: sub.revoked ? "free" : "pro",
      polarSubscriptionId: sub.id,
      polarCustomerId: sub.customerId,
      subscriptionStatus: sub.status,
      currentPeriodEnd: periodEnd ? new Date(periodEnd) : null,
    })
    .where(eq(repositories.id, sub.repositoryId));
}
