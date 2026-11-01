import { asc, eq, TransactionRollbackError } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import * as data from "@/db/seed/data";
import type { DbTransaction } from "@/db/client";
import { seedDatabase } from "@/db/seed/seed";
import { newSecretToken } from "@/lib/ids";
import { hashToken, verifySecret } from "@/modules/auth/hashing";

const client = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema });
afterAll(() => client.end());

const input = {
  ownerEmail: "owner@test.local",
  ownerPassword: "correct horse battery",
  ownerPin: "135790",
  staffPin: "2468",
  counterDeviceToken: newSecretToken(),
  tokenHashPepper: "ab".repeat(32),
};

// Runs fn in a transaction that is always rolled back, so the shared test
// database is unchanged for the other test files. It starts by emptying the
// tables the seed fills (other files leave users and devices behind), so each
// test sees an empty database.
async function inRollback(fn: (tx: DbTransaction) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      for (const table of [
        schema.menuItemModifierGroups,
        schema.menuItems,
        schema.modifierOptions,
        schema.modifierGroups,
        schema.categories,
        schema.qrTokens,
        schema.settings,
        schema.elevations,
        schema.sessions,
        schema.devices,
        schema.users,
      ]) {
        await tx.delete(table);
      }
      await fn(tx);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
}

const seededTables = [
  schema.settings,
  schema.users,
  schema.devices,
  schema.categories,
  schema.modifierGroups,
  schema.modifierOptions,
  schema.menuItems,
  schema.menuItemModifierGroups,
  schema.qrTokens,
];

async function snapshot(tx: DbTransaction) {
  return Promise.all(seededTables.map((table) => tx.select().from(table)));
}

describe("db:seed (Schema §7, P0-06)", () => {
  it("creates the demo data on an empty database", async () => {
    await inRollback(async (tx) => {
      const summary = await seedDatabase(tx, input);
      expect(summary).toEqual({
        settings: 20,
        users: 3,
        devices: 1,
        categories: 4,
        modifierGroups: 4,
        modifierOptions: 10,
        menuItems: 12,
        // 4 coffee-style drinks x 4 groups, 2 drinks x 3, Affogato x 1
        menuItemModifierGroups: 23,
        qrTokens: 7,
      });

      const settings = await tx.select().from(schema.settings);
      expect(Object.fromEntries(settings.map((s) => [s.key, s.value]))).toEqual(
        data.defaultSettings,
      );

      const items = await tx
        .select({
          name: schema.menuItems.name,
          price: schema.menuItems.price,
          isPromoted: schema.menuItems.isPromoted,
        })
        .from(schema.menuItems)
        .orderBy(asc(schema.menuItems.sortOrder));
      expect(items.map((i) => i.name)).toEqual(
        data.menuItems.map((i) => i.name),
      );
      expect(items.filter((i) => i.isPromoted).map((i) => i.name)).toEqual([
        "Roti Bakar",
      ]);
      expect(items.every((i) => Number.isInteger(i.price) && i.price > 0)).toBe(
        true,
      );

      const qr = await tx.select().from(schema.qrTokens);
      expect(qr.map((q) => q.label).sort()).toEqual([...data.qrLabels].sort());
      expect(new Set(qr.map((q) => q.token)).size).toBe(7);
    });
  });

  it("stores only hashes of the owner and staff secrets and the device cookie", async () => {
    await inRollback(async (tx) => {
      await seedDatabase(tx, input);
      const users = await tx.select().from(schema.users);

      const owner = users.find((u) => u.role === "owner")!;
      expect(owner.email).toBe(input.ownerEmail);
      expect(owner.passwordHash).toMatch(/^\$argon2id\$/);
      expect(await verifySecret(owner.passwordHash!, input.ownerPassword)).toBe(
        true,
      );
      expect(await verifySecret(owner.pinHash, input.ownerPin)).toBe(true);

      const staff = users.filter((u) => u.role === "staff");
      expect(staff.map((u) => u.name).sort()).toEqual(
        [...data.staffNames].sort(),
      );
      for (const user of staff) {
        expect(user.email).toBeNull();
        expect(await verifySecret(user.pinHash, input.staffPin)).toBe(true);
      }

      const [device] = await tx.select().from(schema.devices);
      expect(device!.tokenHash).toBe(
        hashToken(input.counterDeviceToken, input.tokenHashPepper),
      );
      expect(device!.tokenHash).not.toContain(input.counterDeviceToken);
      expect(device!.registeredBy).toBe(owner.id);
    });
  });

  it("is idempotent: a second run creates nothing and changes nothing", async () => {
    await inRollback(async (tx) => {
      await seedDatabase(tx, input);
      const before = await snapshot(tx);

      const again = await seedDatabase(tx, {
        ...input,
        ownerPin: "000000",
        counterDeviceToken: newSecretToken(),
      });
      expect(Object.values(again).every((n) => n === 0)).toBe(true);
      expect(await snapshot(tx)).toEqual(before);
    });
  });

  it("keeps owner changes and only fills in what is missing", async () => {
    await inRollback(async (tx) => {
      await seedDatabase(tx, input);
      await tx
        .update(schema.menuItems)
        .set({ price: 99000, isActive: false })
        .where(eq(schema.menuItems.name, "Latte"));
      await tx
        .update(schema.settings)
        .set({ value: 1100 })
        .where(eq(schema.settings.key, "tax_rate_bps"));
      await tx
        .delete(schema.qrTokens)
        .where(eq(schema.qrTokens.label, "Meja 6"));

      const again = await seedDatabase(tx, input);
      expect(again.qrTokens).toBe(1);
      expect(again.menuItems).toBe(0);

      const [latte] = await tx
        .select()
        .from(schema.menuItems)
        .where(eq(schema.menuItems.name, "Latte"));
      expect(latte).toMatchObject({ price: 99000, isActive: false });
      const [tax] = await tx
        .select()
        .from(schema.settings)
        .where(eq(schema.settings.key, "tax_rate_bps"));
      expect(tax!.value).toBe(1100);
    });
  });
});
