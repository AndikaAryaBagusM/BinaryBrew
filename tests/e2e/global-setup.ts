import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { seedDatabase } from "@/db/seed/seed";
import {
  e2eTestDatabaseUrl,
  maintenanceDatabaseUrl,
} from "../integration/databases";

// Recreates the e2e database before every Playwright run: migrations, the
// normal seed, then what the specs rely on (11 % inclusive tax, 5 % service
// charge, and a required group without a default on Roti Bakar). Passes the
// "Meja 1" QR token to the specs as E2E_QR_TOKEN and the counter device
// cookie as E2E_DEVICE_TOKEN; every staff PIN is 1470.
export default async function globalSetup() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("TEST_DATABASE_URL is not set");
  const url = e2eTestDatabaseUrl(testUrl);
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_e2e_test")) {
    throw new Error(`Refusing to reset "${name}": not an e2e test database`);
  }
  const pepper = process.env.TOKEN_HASH_PEPPER;
  if (!pepper) throw new Error("TOKEN_HASH_PEPPER is not set");

  const admin = postgres(maintenanceDatabaseUrl(testUrl), {
    max: 1,
    onnotice: () => {},
  });
  try {
    // FORCE: a dev server from an earlier run may still hold connections.
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.end();
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: "src/db/migrations" });
    // Throwaway credentials: the owner never signs in during these specs.
    const secret = () => randomBytes(32).toString("base64url");
    const deviceToken = secret();
    await seedDatabase(db, {
      ownerEmail: "pemilik@e2e.test",
      ownerPassword: secret(),
      ownerPin: "2580",
      staffPin: "1470",
      counterDeviceToken: deviceToken,
      tokenHashPepper: pepper,
    });

    for (const [key, value] of [
      ["tax_rate_bps", 1100],
      ["service_charge_bps", 500],
    ] as const) {
      await db
        .update(schema.settings)
        .set({ value })
        .where(eq(schema.settings.key, key));
    }

    const [jam] = await db
      .insert(schema.modifierGroups)
      .values({ name: "Pilihan selai", minSelect: 1, maxSelect: 1 })
      .returning();
    await db.insert(schema.modifierOptions).values([
      { groupId: jam!.id, name: "Cokelat", sortOrder: 1 },
      { groupId: jam!.id, name: "Stroberi", sortOrder: 2 },
    ]);
    const [roti] = await db
      .select({ id: schema.menuItems.id })
      .from(schema.menuItems)
      .where(eq(schema.menuItems.name, "Roti Bakar"));
    await db
      .insert(schema.menuItemModifierGroups)
      .values({ menuItemId: roti!.id, groupId: jam!.id });

    const [qr] = await db
      .select({ token: schema.qrTokens.token })
      .from(schema.qrTokens)
      .where(
        and(
          eq(schema.qrTokens.label, "Meja 1"),
          eq(schema.qrTokens.isActive, true),
        ),
      );
    process.env.E2E_QR_TOKEN = qr!.token;
    process.env.E2E_DEVICE_TOKEN = deviceToken;
  } finally {
    await sql.end();
  }
}
