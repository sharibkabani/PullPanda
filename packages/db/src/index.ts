import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export * as orm from "drizzle-orm";

export type Database = ReturnType<typeof createDb>;

export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { max: Number(process.env.DB_POOL_SIZE ?? 10) });
  return drizzle(client, { schema });
}
