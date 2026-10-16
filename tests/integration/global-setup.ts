import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Integration tests start from an empty, freshly migrated test database
// (Tech §12). Runs once before all integration test files.
export default async function setup() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");

  const databaseName = new URL(url).pathname.slice(1);
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to reset "${databaseName}": the test database name must end in _test`,
    );
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`
      drop schema if exists drizzle cascade;
      drop schema public cascade;
      create schema public;
    `);
    await migrate(drizzle(sql), { migrationsFolder: "src/db/migrations" });
  } finally {
    await sql.end();
  }
}
