import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// `npm run db:reset [-- --yes]` (Plan §6 demo step 1): deletes every table
// and row of the local development database and runs the migrations again,
// leaving an empty schema for `npm run db:seed`. Refuses databases that are
// not on this machine and the test databases (their runs recreate them).
// Asks for the database name first unless --yes is given.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const { values } = parseArgs({
    options: { yes: { type: "boolean", default: false } },
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  const { hostname, pathname } = new URL(url);
  const name = decodeURIComponent(pathname.slice(1));
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`Refusing to reset "${name}" on ${hostname}: not local`);
  }
  if (name.endsWith("_test")) {
    throw new Error(`Refusing to reset "${name}": a test database`);
  }

  if (!values.yes) {
    if (!process.stdin.isTTY) {
      throw new Error("Not a terminal: pass --yes to reset without asking");
    }
    const prompt = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await prompt.question(
      `This deletes ALL data in "${name}" (orders, users, menu, rules).\nType the database name to continue: `,
    );
    prompt.close();
    if (answer.trim() !== name) {
      console.log("Not reset.");
      return;
    }
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe("drop schema if exists drizzle cascade");
      await tx.unsafe("drop schema public cascade");
      await tx.unsafe("create schema public");
    });
    await migrate(drizzle(sql), { migrationsFolder: "src/db/migrations" });
  } finally {
    await sql.end();
  }
  console.log(
    `Reset "${name}": empty and migrated. Next: npm run db:seed && npm run seed:orders`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
