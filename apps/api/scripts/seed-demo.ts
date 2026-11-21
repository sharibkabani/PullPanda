/**
 * Local demo data: one user, one installation, three repositories and a review history,
 * plus a signed session cookie value so the dashboard can be opened without GitHub OAuth.
 * Development only: refuses to run with NODE_ENV=production.
 *   bun run apps/api/scripts/seed-demo.ts
 */
import { jwt } from "@elysiajs/jwt";
import { createDb, installations, repositories, reviews, userInstallations, users } from "@pullpanda/db";
import { Elysia } from "elysia";
import { loadEnv } from "../src/env";

const env = loadEnv();
if (env.NODE_ENV === "production") throw new Error("seed-demo is for local development only");
const db = createDb(env.DATABASE_URL);

const [user] = await db
  .insert(users)
  .values({ githubId: 1000001, login: "demo-dev", name: "Demo Developer", email: "demo@pullpanda.example", avatarUrl: null })
  .onConflictDoUpdate({ target: users.githubId, set: { login: "demo-dev" } })
  .returning();

await db.insert(installations).values({ id: 9000001, accountId: 7000001, accountLogin: "acme", accountType: "Organization" }).onConflictDoNothing();
await db.insert(userInstallations).values({ userId: user!.id, installationId: 9000001 }).onConflictDoNothing();
await db
  .insert(repositories)
  .values([
    { id: 8000001, installationId: 9000001, fullName: "acme/api", private: false },
    { id: 8000002, installationId: 9000001, fullName: "acme/payments", private: true, plan: "pro", subscriptionStatus: "active", currentPeriodEnd: new Date(Date.now() + 20 * 86400e3) },
    { id: 8000003, installationId: 9000001, fullName: "acme/mobile", private: true },
  ])
  .onConflictDoNothing();

const now = Date.now();
const rows = [
  { repo: 8000001, pr: 212, status: "completed", comments: 3, files: 7, ms: 38_200, ago: 5 },
  { repo: 8000002, pr: 211, status: "completed", comments: 1, files: 2, ms: 21_900, ago: 40 },
  { repo: 8000001, pr: 210, status: "failed", comments: 0, files: 0, ms: 1_200, ago: 90, error: "GitHub 403: Resource not accessible by integration" },
  { repo: 8000003, pr: 44, status: "skipped", comments: 0, files: 0, ms: null, ago: 120, skip: "Private repositories need PullPanda Pro." },
  { repo: 8000001, pr: 209, status: "completed", comments: 0, files: 1, ms: 12_400, ago: 300 },
  { repo: 8000002, pr: 206, status: "completed", comments: 5, files: 11, ms: 61_000, ago: 900 },
  { repo: 8000001, pr: 208, status: "skipped", comments: 0, files: 0, ms: 300, ago: 1400, skip: "draft pull request" },
] as const;
for (const [i, r] of rows.entries()) {
  await db
    .insert(reviews)
    .values({
      repositoryId: r.repo,
      installationId: 9000001,
      prNumber: r.pr,
      headSha: `demo${i}`.padEnd(40, "0"),
      status: r.status,
      plan: r.repo === 8000002 ? "pro" : "free",
      commentsPosted: r.comments,
      filesReviewed: r.files,
      durationMs: r.ms,
      skipReason: "skip" in r ? r.skip : null,
      error: "error" in r ? r.error : null,
      createdAt: new Date(now - r.ago * 60e3),
      completedAt: new Date(now - r.ago * 60e3),
    })
    .onConflictDoNothing();
}

const signer = new Elysia().use(jwt({ name: "session", secret: env.SESSION_SECRET, exp: "30d" }));
const token = await signer.decorator.session.sign({ sub: user!.id });
console.log(`seeded demo data for ${user!.login}\npp_session=${token}`);
process.exit(0);
