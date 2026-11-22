import { afterAll, expect, test } from "bun:test";
import { createDb, orm, repositories } from "@pullpanda/db";
import { jwt } from "@elysiajs/jwt";
import { Elysia } from "elysia";
import { createApp } from "../src/app";
import { loadEnv } from "../src/env";
import { linkUserInstallations, upsertInstallation, upsertRepositories, upsertUser } from "../src/services/store";

/**
 * Regression: routes behave differently on a real Bun server (native router, frozen params) than through
 * app.handle(). This boots the app on a port and calls it over HTTP.
 */
const DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://pullpanda:pullpanda@localhost:5432/pullpanda_test";
const db = createDb(DB_URL);
const env = loadEnv({ NODE_ENV: "test", DATABASE_URL: DB_URL, PORT: "0" });
const app = createApp({
  env,
  db,
  enqueueReview: async () => {},
  claimDelivery: async () => true,
  releaseDelivery: async () => {},
  oauth: null,
  billing: null,
  health: async () => ({ database: true }),
}).listen(0);
afterAll(() => app.stop());

test("PATCH /api/repositories/:id works over a live server", async () => {
  await db.execute(orm.sql`truncate users, installations, repositories, reviews, user_installations, processed_events cascade`);
  const user = await upsertUser(db, { id: 42, login: "live", name: null, email: null, avatar_url: "" });
  await upsertInstallation(db, { id: 5, account: { id: 6, login: "acme", type: "Organization" } });
  await upsertRepositories(db, 5, [{ id: 77, full_name: "acme/live", private: false }]);
  await linkUserInstallations(db, user.id, [5]);
  const token = await new Elysia().use(jwt({ name: "session", secret: env.SESSION_SECRET })).decorator.session.sign({ sub: user.id });

  const base = `http://localhost:${app.server!.port}`;
  const res = await fetch(`${base}/api/repositories/77`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: `pp_session=${token}` },
    body: JSON.stringify({ enabled: false }),
  });
  expect(res.status).toBe(200);
  const [row] = await db.select().from(repositories).where(orm.eq(repositories.id, 77));
  expect(row!.enabled).toBe(false);

  const bad = await fetch(`${base}/api/repositories/abc`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: `pp_session=${token}` },
    body: JSON.stringify({ enabled: true }),
  });
  expect(bad.status).toBe(400);
});
