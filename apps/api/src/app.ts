import { cors } from "@elysiajs/cors";
import { jwt } from "@elysiajs/jwt";
import { openapi } from "@elysiajs/openapi";
import { logger, verifyGithubSignature } from "@pullpanda/core";
import { users, orm } from "@pullpanda/db";
import { Elysia, t } from "elysia";
import type { ApiDeps } from "./deps";
import { handleGitHubEvent } from "./services/github-events";
import { handlePolarEvent } from "./services/polar-events";
import {
  claimEvent,
  dashboardData,
  linkUserInstallations,
  setRepositoryEnabled,
  upsertInstallation,
  upsertRepositories,
  upsertUser,
  userCanAccessRepo,
} from "./services/store";

const SESSION_COOKIE = "pp_session";
const STATE_COOKIE = "pp_oauth_state";

export function createApp(deps: ApiDeps) {
  const { env, db } = deps;
  const secure = env.NODE_ENV === "production";
  const cookieBase = { httpOnly: true, secure, sameSite: env.COOKIE_SAMESITE, path: "/" } as const;
  const callbackUrl = `${env.API_URL}/auth/github/callback`;

  return new Elysia()
    .use(cors({ origin: env.WEB_URL, credentials: true }))
    .use(openapi({ path: "/docs", documentation: { info: { title: "PullPanda API", version: "0.1.0" } } }))
    .use(jwt({ name: "session", secret: env.SESSION_SECRET, exp: "30d" }))
    .onError(({ code, error, set }) => {
      if (code === "NOT_FOUND") return { error: "not found" };
      if (code === "VALIDATION") return { error: "invalid request", detail: error.message };
      logger.error({ err: error }, "unhandled error");
      set.status = 500;
      return { error: "internal error" };
    })

    .get("/health", async ({ set }) => {
      const checks = await deps.health();
      const ok = Object.values(checks).every(Boolean);
      if (!ok) set.status = 503;
      return { ok, checks };
    })

    // ---------- GitHub App webhooks ----------
    .post(
      "/webhooks/github",
      async ({ request, set }) => {
        if (!env.GITHUB_WEBHOOK_SECRET) {
          set.status = 503;
          return { error: "GitHub webhooks not configured" };
        }
        const raw = await request.text();
        if (!verifyGithubSignature(env.GITHUB_WEBHOOK_SECRET, raw, request.headers.get("x-hub-signature-256"))) {
          set.status = 401;
          return { error: "invalid signature" };
        }
        const delivery = request.headers.get("x-github-delivery");
        if (delivery && !(await deps.claimDelivery(delivery))) return { duplicate: true };

        const event = request.headers.get("x-github-event") ?? "unknown";
        const result = await handleGitHubEvent(deps, event, JSON.parse(raw));
        set.status = result.status;
        return result.body;
      },
      { parse: "none", detail: { summary: "GitHub App webhook receiver (HMAC-verified)" } },
    )

    // ---------- Polar billing webhooks ----------
    .post(
      "/webhooks/polar",
      async ({ request, set }) => {
        if (!deps.billing) {
          set.status = 503;
          return { error: "billing not configured" };
        }
        const raw = await request.text();
        const headers = Object.fromEntries(request.headers.entries());
        let event: { type: string; data: unknown };
        try {
          event = await deps.billing.verifyWebhook(raw, headers);
        } catch (e) {
          logger.warn({ err: e }, "polar webhook rejected");
          set.status = 403;
          return { error: "invalid signature" };
        }
        const id = headers["webhook-id"];
        if (id && !(await claimEvent(db, "polar", id))) return { duplicate: true };
        return handlePolarEvent(db, event);
      },
      { parse: "none", detail: { summary: "Polar subscription webhook receiver" } },
    )

    // ---------- GitHub OAuth (dashboard login) ----------
    .get("/auth/github", ({ cookie, redirect, set }) => {
      if (!deps.oauth) {
        set.status = 503;
        return { error: "GitHub login not configured" };
      }
      const state = crypto.randomUUID();
      cookie[STATE_COOKIE]!.set({ value: state, ...cookieBase, maxAge: 600 });
      return redirect(deps.oauth.authorizeUrl(state, callbackUrl));
    })
    .get(
      "/auth/github/callback",
      async ({ query, cookie, redirect, session, set }) => {
        if (!deps.oauth) {
          set.status = 503;
          return { error: "GitHub login not configured" };
        }
        const expected = cookie[STATE_COOKIE]!.value;
        cookie[STATE_COOKIE]!.remove();
        if (!expected || expected !== query.state) {
          set.status = 400;
          return { error: "invalid oauth state" };
        }
        const token = await deps.oauth.exchangeCode(query.code, callbackUrl);
        const ghUser = await deps.oauth.getUser(token);
        const user = await upsertUser(db, ghUser);

        // Sync what this user can manage so the dashboard is correct even if webhooks were missed.
        const insts = await deps.oauth.listInstallations(token);
        for (const inst of insts) {
          await upsertInstallation(db, { id: inst.id, account: inst.account, suspended: Boolean(inst.suspended_at) });
          await upsertRepositories(db, inst.id, await deps.oauth.listInstallationRepos(token, inst.id));
        }
        await linkUserInstallations(db, user.id, insts.map((i) => i.id));

        cookie[SESSION_COOKIE]!.set({ value: await session.sign({ sub: user.id }), ...cookieBase, maxAge: 30 * 86400 });
        return redirect(`${env.WEB_URL}/dashboard`);
      },
      { query: t.Object({ code: t.String(), state: t.String() }) },
    )
    .post("/auth/logout", ({ cookie }) => {
      cookie[SESSION_COOKIE]!.remove();
      return { ok: true };
    })

    .get("/config", () => ({
      installUrl: env.GITHUB_APP_SLUG ? `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new` : null,
      loginUrl: `${env.API_URL}/auth/github`,
      billingEnabled: Boolean(deps.billing),
    }))

    // ---------- Authenticated dashboard API ----------
    .group("/api", (api) =>
      api
        .derive(async ({ cookie, session }) => {
          const token = cookie[SESSION_COOKIE]?.value;
          const claims = typeof token === "string" ? await session.verify(token) : false;
          return { userId: claims && typeof claims.sub === "string" ? claims.sub : null };
        })
        .onBeforeHandle(({ userId, set }) => {
          if (!userId) {
            set.status = 401;
            return { error: "unauthorized" };
          }
        })
        .get("/me", async ({ userId }) => {
          const user = await db.query.users.findFirst({ where: orm.eq(users.id, userId!) });
          return { user, ...(await dashboardData(db, userId!)) };
        })
        .patch(
          "/repositories/:id",
          async ({ userId, params, body, set }) => {
            // Parsed by hand: a params schema makes Elysia redefine properties on the params object that
            // Bun's native router hands it, which throws on a live server (app.handle in tests never sees it).
            const id = Number(params.id);
            if (!Number.isSafeInteger(id) || id <= 0) {
              set.status = 400;
              return { error: "invalid repository id" };
            }
            const repo = await userCanAccessRepo(db, userId!, id);
            if (!repo) {
              set.status = 404;
              return { error: "repository not found" };
            }
            await setRepositoryEnabled(db, repo.id, body.enabled);
            return { ok: true };
          },
          { body: t.Object({ enabled: t.Boolean() }) },
        )
        .post(
          "/billing/checkout",
          async ({ userId, body, set }) => {
            if (!deps.billing) {
              set.status = 503;
              return { error: "billing not configured" };
            }
            const repo = await userCanAccessRepo(db, userId!, body.repositoryId);
            if (!repo) {
              set.status = 404;
              return { error: "repository not found" };
            }
            const user = await db.query.users.findFirst({ where: orm.eq(users.id, userId!) });
            return deps.billing.createCheckout({
              repositoryId: repo.id,
              installationId: repo.installationId,
              userId: userId!,
              email: user?.email ?? null,
              successUrl: `${env.WEB_URL}/dashboard?upgraded=${repo.id}`,
              returnUrl: `${env.WEB_URL}/dashboard`,
            });
          },
          { body: t.Object({ repositoryId: t.Number() }) },
        )
        .post("/billing/portal", async ({ userId, set }) => {
          if (!deps.billing) {
            set.status = 503;
            return { error: "billing not configured" };
          }
          return deps.billing.createPortalSession({ userId: userId!, returnUrl: `${env.WEB_URL}/dashboard` });
        }),
    );
}

export type App = ReturnType<typeof createApp>;
