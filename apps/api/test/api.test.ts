import { beforeEach, describe, expect, test } from "bun:test";
import { signGithubPayload, type ReviewJobData } from "@pullpanda/core";
import { createDb, orm, repositories, reviews, users } from "@pullpanda/db";
import { createApp } from "../src/app";
import type { ApiDeps } from "../src/deps";
import { loadEnv } from "../src/env";

const DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://pullpanda:pullpanda@localhost:5432/pullpanda_test";
const SECRET = "whsec_test";
const db = createDb(DB_URL);
const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: DB_URL, GITHUB_WEBHOOK_SECRET: SECRET });

let queued: ReviewJobData[];
let deliveries: Set<string>;
let polarEvents: { type: string; data: unknown }[];

function makeApp(over: Partial<ApiDeps> = {}) {
  return createApp({
    env,
    db,
    // Like BullMQ with a deterministic job id: adding the same review twice is a no-op.
    enqueueReview: async (job) => void (queued.some((q) => q.reviewId === job.reviewId) || queued.push(job)),
    claimDelivery: async (id) => (deliveries.has(id) ? false : (deliveries.add(id), true)),
    releaseDelivery: async (id) => void deliveries.delete(id),
    oauth: {
      authorizeUrl: (state) => `https://github.test/authorize?state=${state}`,
      exchangeCode: async () => "user-token",
      getUser: async () => ({ id: 555, login: "octocat", name: "Octo", email: "o@example.com", avatar_url: "https://x/a.png" }),
      listInstallations: async () => [{ id: 1, account: { id: 9, login: "acme", type: "Organization" }, suspended_at: null }],
      listInstallationRepos: async () => [
        { id: 100, full_name: "acme/api", private: false },
        { id: 101, full_name: "acme/secret", private: true },
      ],
    },
    billing: {
      createCheckout: async (i) => ({ url: `https://polar.test/checkout?repo=${i.repositoryId}` }),
      createPortalSession: async () => ({ url: "https://polar.test/portal" }),
      verifyWebhook: async (raw, headers) => {
        if (headers["webhook-signature"] !== "valid") throw new Error("bad signature");
        const e = JSON.parse(raw);
        polarEvents.push(e);
        return e;
      },
    },
    health: async () => ({ database: true, redis: true }),
    ...over,
  });
}

const prPayload = (over: { action?: string; sha?: string; repoId?: number; isPrivate?: boolean; pr?: number } = {}) => ({
  action: over.action ?? "opened",
  installation: { id: 1 },
  repository: {
    id: over.repoId ?? 100,
    name: "api",
    full_name: "acme/api",
    private: over.isPrivate ?? false,
    owner: { id: 9, login: "acme", type: "Organization" },
  },
  pull_request: { number: over.pr ?? 7, head: { sha: over.sha ?? "sha1" } },
});

function ghRequest(event: string, payload: unknown, opts: { delivery?: string; signature?: string } = {}) {
  const body = JSON.stringify(payload);
  return new Request("http://api.test/webhooks/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": opts.delivery ?? crypto.randomUUID(),
      "x-hub-signature-256": opts.signature ?? signGithubPayload(SECRET, body),
    },
    body,
  });
}

beforeEach(async () => {
  queued = [];
  deliveries = new Set();
  polarEvents = [];
  await db.execute(orm.sql`truncate users, installations, repositories, reviews, user_installations, processed_events cascade`);
});

describe("GitHub webhook", () => {
  test("rejects a bad signature without touching the database", async () => {
    const res = await makeApp().handle(ghRequest("pull_request", prPayload(), { signature: "sha256=deadbeef" }));
    expect(res.status).toBe(401);
    expect(queued).toHaveLength(0);
  });

  test("queues a review for an opened PR on a public repo", async () => {
    const res = await makeApp().handle(ghRequest("pull_request", prPayload()));
    expect(res.status).toBe(202);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ owner: "acme", repo: "api", prNumber: 7, headSha: "sha1", plan: "free" });
    const rows = await db.select().from(reviews);
    expect(rows[0]!.status).toBe("queued");
  });

  test("is idempotent: same delivery and same commit are only queued once", async () => {
    const app = makeApp();
    await app.handle(ghRequest("pull_request", prPayload(), { delivery: "d1" }));
    const again = await app.handle(ghRequest("pull_request", prPayload(), { delivery: "d1" }));
    expect(await again.json() as any).toEqual({ duplicate: true });
    // a redelivery with a new id but the same commit re-enqueues the still-queued review, which the queue dedupes
    const sameSha = await app.handle(ghRequest("pull_request", prPayload({ action: "reopened" })));
    expect((await sameSha.json() as any).requeued).toBe(true);
    expect(queued).toHaveLength(1);
    // a new push is a new review
    await app.handle(ghRequest("pull_request", prPayload({ action: "synchronize", sha: "sha2" })));
    expect(queued).toHaveLength(2);
  });

  test("a failed enqueue returns 5xx and GitHub's redelivery of the same delivery id recovers it", async () => {
    let redisDown = true;
    const app = makeApp({
      enqueueReview: async (job) => {
        if (redisDown) throw new Error("ECONNREFUSED redis");
        queued.push(job);
      },
    });
    const first = await app.handle(ghRequest("pull_request", prPayload(), { delivery: "d-fail" }));
    expect(first.status).toBe(500);
    redisDown = false;
    const retry = await app.handle(ghRequest("pull_request", prPayload(), { delivery: "d-fail" }));
    expect(retry.status).toBe(202);
    expect(queued).toHaveLength(1);
    const rows = await db.select().from(reviews);
    expect(rows).toHaveLength(1);
  });

  test("malformed but signed payloads are a 400, not a 500", async () => {
    expect((await makeApp().handle(ghRequest("pull_request", null))).status).toBe(400);
    expect((await makeApp().handle(ghRequest("pull_request", { action: "opened" }))).status).toBe(400);
  });

  test("ignores irrelevant PR actions", async () => {
    const res = await makeApp().handle(ghRequest("pull_request", prPayload({ action: "labeled" })));
    expect(await res.json() as any).toEqual({ ignored: "action labeled" });
    expect(queued).toHaveLength(0);
  });

  test("private repos on the free plan are recorded as skipped, not queued", async () => {
    const res = await makeApp().handle(ghRequest("pull_request", prPayload({ repoId: 101, isPrivate: true })));
    expect(await res.json() as any).toEqual({ skipped: "Private repositories need DiffPanda Pro." });
    expect(queued).toHaveLength(0);
    const [row] = await db.select().from(reviews);
    expect(row!.status).toBe("skipped");
  });

  test("enforces the free monthly quota per installation", async () => {
    const app = makeApp();
    for (let i = 0; i < 30; i++) await app.handle(ghRequest("pull_request", prPayload({ sha: `s${i}` })));
    expect(queued).toHaveLength(30);
    const res = await app.handle(ghRequest("pull_request", prPayload({ sha: "one-too-many" })));
    expect((await res.json() as any).skipped).toContain("Monthly limit");
  });

  test("the monthly quota holds under concurrent webhooks for one installation", async () => {
    const app = makeApp();
    await app.handle(ghRequest("pull_request", prPayload({ sha: "warm" })));
    const results = await Promise.all(
      Array.from({ length: 60 }, (_, i) => app.handle(ghRequest("pull_request", prPayload({ sha: `race-${i}` })))),
    );
    expect(results.every((r) => r.status === 202 || r.status === 200)).toBe(true);
    expect(queued).toHaveLength(30);
  });

  test("a suspended installation stays suspended when PR events keep arriving", async () => {
    const app = makeApp();
    const inst = { id: 1, account: { id: 9, login: "acme", type: "Organization" } };
    await app.handle(ghRequest("installation", { action: "created", installation: inst, repositories: [{ id: 100, full_name: "acme/api", private: false }] }));
    await app.handle(ghRequest("installation", { action: "suspend", installation: inst }));
    const first = await app.handle(ghRequest("pull_request", prPayload({ sha: "s-a" })));
    expect((await first.json() as any).skipped).toBe("installation suspended");
    const second = await app.handle(ghRequest("pull_request", prPayload({ sha: "s-b" })));
    expect((await second.json() as any).skipped).toBe("installation suspended");
    expect(queued).toHaveLength(0);
  });

  test("installation events sync repos; deletion cascades", async () => {
    const app = makeApp();
    await app.handle(
      ghRequest("installation", {
        action: "created",
        installation: { id: 1, account: { id: 9, login: "acme", type: "Organization" } },
        repositories: [{ id: 100, full_name: "acme/api", private: false }],
      }),
    );
    expect(await db.select().from(repositories)).toHaveLength(1);
    await app.handle(ghRequest("installation", { action: "deleted", installation: { id: 1, account: { id: 9, login: "acme", type: "Organization" } } }));
    expect(await db.select().from(repositories)).toHaveLength(0);
  });
});

async function login(app: ReturnType<typeof makeApp>) {
  const start = await app.handle(new Request("http://api.test/auth/github"));
  expect(start.status).toBe(302);
  const stateCookie = start.headers.get("set-cookie")!.split(";")[0]!;
  const state = new URL(start.headers.get("location")!).searchParams.get("state");
  const cb = await app.handle(
    new Request(`http://api.test/auth/github/callback?code=abc&state=${state}`, { headers: { cookie: stateCookie } }),
  );
  expect(cb.status).toBe(302);
  expect(cb.headers.get("location")).toBe("http://localhost:3000/dashboard");
  const session = cb.headers.getSetCookie().find((c) => c.startsWith("pp_session="))!;
  return session.split(";")[0]!;
}

describe("auth + dashboard", () => {
  test("rejects a forged oauth state", async () => {
    const res = await makeApp().handle(
      new Request("http://api.test/auth/github/callback?code=abc&state=evil", { headers: { cookie: "pp_oauth_state=real" } }),
    );
    expect(res.status).toBe(400);
  });

  test("login syncs installations and the dashboard returns them", async () => {
    const app = makeApp();
    expect((await app.handle(new Request("http://api.test/api/me"))).status).toBe(401);
    const cookie = await login(app);
    const me = await (await app.handle(new Request("http://api.test/api/me", { headers: { cookie } }))).json() as any;
    expect(me.user.login).toBe("octocat");
    expect(me.repositories.map((r: { fullName: string }) => r.fullName)).toEqual(["acme/api", "acme/secret"]);
    expect(me.repositories[1].effectivePlan).toBe("free");
  });

  test("checkout only for repos the user can access; toggling a repo disables reviews", async () => {
    const app = makeApp();
    const cookie = await login(app);
    const json = { "content-type": "application/json", cookie };
    const ok = await app.handle(new Request("http://api.test/api/billing/checkout", { method: "POST", headers: json, body: JSON.stringify({ repositoryId: 101 }) }));
    expect(await ok.json() as any).toEqual({ url: "https://polar.test/checkout?repo=101" });
    const denied = await app.handle(new Request("http://api.test/api/billing/checkout", { method: "POST", headers: json, body: JSON.stringify({ repositoryId: 999 }) }));
    expect(denied.status).toBe(404);

    await app.handle(new Request("http://api.test/api/repositories/100", { method: "PATCH", headers: json, body: JSON.stringify({ enabled: false }) }));
    const res = await app.handle(ghRequest("pull_request", prPayload()));
    expect((await res.json() as any).skipped).toBe("repository disabled in dashboard");
  });
});

describe("Polar webhook", () => {
  const polarRequest = (payload: unknown, sig = "valid", id: string = crypto.randomUUID()) =>
    new Request("http://api.test/webhooks/polar", {
      method: "POST",
      headers: { "content-type": "application/json", "webhook-id": id, "webhook-signature": sig, "webhook-timestamp": "0" },
      body: JSON.stringify(payload),
    });
  let buyer = "";
  const sub = (type: string, status: string, modifiedAt = "2026-11-01T00:00:00Z", userId: string = buyer) => ({
    type,
    data: {
      id: "sub_1", status, customer_id: "cus_1", current_period_end: "2099-01-01T00:00:00Z", ends_at: null,
      created_at: "2026-11-01T00:00:00Z", modified_at: modifiedAt, metadata: { repositoryId: 101, userId },
    },
  });
  const loginBuyer = async (app: ReturnType<typeof makeApp>) => {
    await login(app);
    buyer = (await db.select().from(users))[0]!.id;
  };
  const planOf101 = async () => (await db.select().from(repositories).where(orm.eq(repositories.id, 101)))[0]!.plan;

  test("an active subscription upgrades the repo; private PRs are then queued as pro", async () => {
    const app = makeApp();
    await loginBuyer(app);
    expect((await app.handle(polarRequest(sub("subscription.active", "active"), "nope"))).status).toBe(403);
    expect((await app.handle(polarRequest(sub("subscription.active", "active")))).status).toBe(200);

    const res = await app.handle(ghRequest("pull_request", prPayload({ repoId: 101, isPrivate: true })));
    expect(res.status).toBe(202);
    expect(queued[0]!.plan).toBe("pro");

    await app.handle(polarRequest(sub("subscription.revoked", "canceled", "2026-11-02T00:00:00Z")));
    expect(await planOf101()).toBe("free");
  });

  test("an older event arriving late doesn't undo a newer one", async () => {
    const app = makeApp();
    await loginBuyer(app);
    await app.handle(polarRequest(sub("subscription.revoked", "canceled", "2026-11-05T00:00:00Z")));
    const late = await app.handle(polarRequest(sub("subscription.active", "active", "2026-11-01T00:00:00Z")));
    expect((await late.json() as any).stale).toBe(true);
    expect(await planOf101()).toBe("free");
  });

  test("a subscription naming a repository its buyer can't manage is ignored", async () => {
    const app = makeApp();
    await loginBuyer(app);
    const res = await app.handle(polarRequest(sub("subscription.active", "active", undefined, "00000000-0000-0000-0000-000000000000")));
    expect(await res.json() as any).toEqual({ handled: false });
    expect(await planOf101()).toBe("free");
  });

  test("duplicate webhook ids are applied once", async () => {
    const app = makeApp();
    await app.handle(polarRequest(sub("subscription.active", "active"), "valid", "evt_1"));
    const dup = await app.handle(polarRequest(sub("subscription.active", "active"), "valid", "evt_1"));
    expect(await dup.json() as any).toEqual({ duplicate: true });
  });
});

test("health reports dependency status", async () => {
  const res = await makeApp({ health: async () => ({ database: true, redis: false }) }).handle(new Request("http://api.test/health"));
  expect(res.status).toBe(503);
});
