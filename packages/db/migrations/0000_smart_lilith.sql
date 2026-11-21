CREATE TYPE "public"."plan" AS ENUM('free', 'pro');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('queued', 'running', 'completed', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "installations" (
	"id" bigint PRIMARY KEY NOT NULL,
	"account_id" bigint NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" bigint PRIMARY KEY NOT NULL,
	"installation_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"private" boolean NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"polar_subscription_id" text,
	"polar_customer_id" text,
	"subscription_status" text,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" bigint NOT NULL,
	"installation_id" bigint NOT NULL,
	"pr_number" integer NOT NULL,
	"head_sha" text NOT NULL,
	"status" "review_status" DEFAULT 'queued' NOT NULL,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"skip_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"files_reviewed" integer DEFAULT 0 NOT NULL,
	"comments_posted" integer DEFAULT 0 NOT NULL,
	"findings" jsonb,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" real DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"github_review_id" bigint,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_installations" (
	"user_id" uuid NOT NULL,
	"installation_id" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" bigint NOT NULL,
	"login" text NOT NULL,
	"name" text,
	"email" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_installations" ADD CONSTRAINT "user_installations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_installations" ADD CONSTRAINT "user_installations_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repositories_installation_idx" ON "repositories" USING btree ("installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_commit_uq" ON "reviews" USING btree ("repository_id","pr_number","head_sha");--> statement-breakpoint
CREATE INDEX "reviews_installation_created_idx" ON "reviews" USING btree ("installation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_installation_uq" ON "user_installations" USING btree ("user_id","installation_id");