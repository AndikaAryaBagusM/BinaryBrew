import postgres from "postgres";
import { getEnv } from "@/lib/env";

// One pool per process. The dev server re-evaluates modules on reload, so the
// pool is kept on globalThis there to avoid leaking connections.
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

export function getSql(): postgres.Sql {
  globalForDb.sql ??= postgres(getEnv().DATABASE_URL, {
    max: 10,
    connect_timeout: 5,
  });
  return globalForDb.sql;
}

export async function pingDatabase(): Promise<void> {
  await getSql()`select 1`;
}

export async function closeSql(): Promise<void> {
  await globalForDb.sql?.end();
  globalForDb.sql = undefined;
}
