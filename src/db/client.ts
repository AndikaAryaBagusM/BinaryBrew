import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

// One pool per process. The dev server re-evaluates modules on reload, so the
// pool is kept on globalThis there to avoid leaking connections.
const globalForDb = globalThis as unknown as { sql?: postgres.Sql; db?: Db };

export function getSql(): postgres.Sql {
  globalForDb.sql ??= postgres(getEnv().DATABASE_URL, {
    max: 10,
    connect_timeout: 5,
  });
  return globalForDb.sql;
}

export function getDb(): Db {
  globalForDb.db ??= drizzle(getSql(), { schema });
  return globalForDb.db;
}

export async function pingDatabase(): Promise<void> {
  await getSql()`select 1`;
}

export async function closeSql(): Promise<void> {
  await globalForDb.sql?.end();
  globalForDb.sql = undefined;
  globalForDb.db = undefined;
}
