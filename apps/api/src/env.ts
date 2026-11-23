import { z } from "zod";

/** A blank line copied from .env.example (`KEY=`) means "not set", not an invalid empty value. */
const blankIsUnset = (v: unknown) => (v === "" ? undefined : v);
const optional = z.preprocess(blankIsUnset, z.string().min(1).optional());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),
  API_URL: z.string().url().default("http://localhost:3001"),
  WEB_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().default("postgres://pullpanda:pullpanda@localhost:5432/pullpanda"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  SESSION_SECRET: z.string().min(32).default("dev-only-session-secret-change-me-please"),
  /** "none" when the web app and API live on different sites in production. */
  COOKIE_SAMESITE: z.enum(["lax", "none", "strict"]).default("lax"),

  GITHUB_APP_ID: optional,
  GITHUB_APP_SLUG: optional,
  /** PEM contents; "\n" escapes and base64 are both accepted. */
  GITHUB_APP_PRIVATE_KEY: optional,
  GITHUB_WEBHOOK_SECRET: optional,
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,

  POLAR_ACCESS_TOKEN: optional,
  POLAR_WEBHOOK_SECRET: optional,
  POLAR_PRO_PRODUCT_ID: optional,
  POLAR_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const env = schema.parse(Object.fromEntries(Object.entries(source).filter(([, v]) => v !== "")));
  if (env.NODE_ENV === "production" && env.SESSION_SECRET.startsWith("dev-only")) {
    throw new Error("SESSION_SECRET must be set in production");
  }
  return env;
}

export function decodePrivateKey(raw: string): string {
  if (raw.includes("BEGIN")) return raw.replace(/\\n/g, "\n");
  return Buffer.from(raw, "base64").toString("utf8");
}
