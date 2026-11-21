import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const planEnum = pgEnum("plan", ["free", "pro"]);
export const reviewStatusEnum = pgEnum("review_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "skipped",
]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** People who signed in to the dashboard with GitHub. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  login: text("login").notNull(),
  name: text("name"),
  email: text("email"),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
});

/** One row per GitHub App installation (a user or org account). */
export const installations = pgTable("installations", {
  id: bigint("id", { mode: "number" }).primaryKey(), // GitHub installation id
  accountId: bigint("account_id", { mode: "number" }).notNull(),
  accountLogin: text("account_login").notNull(),
  accountType: text("account_type").notNull(), // "User" | "Organization"
  suspended: boolean("suspended").notNull().default(false),
  createdAt: createdAt(),
});

/** Links dashboard users to installations they can manage. */
export const userInstallations = pgTable(
  "user_installations",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    installationId: bigint("installation_id", { mode: "number" })
      .notNull()
      .references(() => installations.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("user_installation_uq").on(t.userId, t.installationId)],
);

/** Repositories PullPanda can see, with per-repo billing (Pro is sold per repo). */
export const repositories = pgTable(
  "repositories",
  {
    id: bigint("id", { mode: "number" }).primaryKey(), // GitHub repo id
    installationId: bigint("installation_id", { mode: "number" })
      .notNull()
      .references(() => installations.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    private: boolean("private").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    plan: planEnum("plan").notNull().default("free"),
    polarSubscriptionId: text("polar_subscription_id"),
    polarCustomerId: text("polar_customer_id"),
    subscriptionStatus: text("subscription_status"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("repositories_installation_idx").on(t.installationId)],
);

/** Every review attempt. (repo, pr, sha) is unique so a commit is never reviewed twice. */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    repositoryId: bigint("repository_id", { mode: "number" })
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    installationId: bigint("installation_id", { mode: "number" }).notNull(),
    prNumber: integer("pr_number").notNull(),
    headSha: text("head_sha").notNull(),
    status: reviewStatusEnum("status").notNull().default("queued"),
    /** Plan the review was billed against, for monthly quota counting. */
    plan: planEnum("plan").notNull().default("free"),
    skipReason: text("skip_reason"),
    attempts: integer("attempts").notNull().default(0),
    filesReviewed: integer("files_reviewed").notNull().default(0),
    commentsPosted: integer("comments_posted").notNull().default(0),
    findings: jsonb("findings"),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    durationMs: integer("duration_ms"),
    githubReviewId: bigint("github_review_id", { mode: "number" }),
    error: text("error"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("reviews_commit_uq").on(t.repositoryId, t.prNumber, t.headSha),
    index("reviews_installation_created_idx").on(t.installationId, t.createdAt),
    // the monthly quota counts (store.reviewsThisMonth) filter by scope, plan and month
    index("reviews_quota_installation_idx").on(t.installationId, t.plan, t.createdAt),
    index("reviews_quota_repository_idx").on(t.repositoryId, t.plan, t.createdAt),
  ],
);

/** Polar webhook ids we've already applied (webhooks are at-least-once). */
export const processedEvents = pgTable("processed_events", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  createdAt: createdAt(),
});

export const monthStart = sql`date_trunc('month', now())`;

export type User = typeof users.$inferSelect;
export type Installation = typeof installations.$inferSelect;
export type Repository = typeof repositories.$inferSelect;
export type Review = typeof reviews.$inferSelect;
