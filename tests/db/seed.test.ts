import { asc, eq, sql, TransactionRollbackError } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import type { DbTransaction } from "@/db/client";
import * as schema from "@/db/schema";
import * as data from "@/db/seed/data";
import { seedDatabase } from "@/db/seed/seed";
import { newSecretToken } from "@/lib/ids";
import { hashToken, verifySecret } from "@/modules/auth/hashing";
import { emptyTestDatabaseUrl } from "../integration/databases";

const client = postgres(emptyTestDatabaseUrl(process.env.TEST_DATABASE_URL!), {
  max: 1,
});
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

// Runs fn in a transaction that is always rolled back, on the empty test
// database (other integration files leave users, devices and audit rows in the
// shared one), so every test starts from an empty database.
async function inRollback(fn: (tx: DbTransaction) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
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
  schema.suppliers,
  schema.ingredients,
  schema.stockMovements,
  schema.recipeItems,
  schema.modifierOptionIngredients,
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
        suppliers: 3,
        ingredients: 18,
        stockMovements: 18,
        recipeItems: 41,
        modifierOptionIngredients: 4,
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

  it("gives every seeded ingredient its opening movement and cost (I7)", async () => {
    await inRollback(async (tx) => {
      await seedDatabase(tx, input);
      const rows = await tx.execute<{
        name: string;
        stock_qty: string;
        ledger: string;
        avg_cost: string;
        movements: number;
        created_by_owner: boolean;
      }>(sql`
        select i.name, i.stock_qty, i.avg_cost,
          coalesce(sum(m.qty_delta), 0) as ledger,
          count(m.id)::int as movements,
          bool_and(m.type = 'opening' and u.role = 'owner') as created_by_owner
        from ingredients i
        left join stock_movements m on m.ingredient_id = i.id
        left join users u on u.id = m.created_by
        group by i.id`);
      expect(rows.map((r) => r.name).sort()).toEqual(
        data.ingredients.map((i) => i.name).sort(),
      );
      for (const row of rows) {
        expect(Number(row.ledger), row.name).toBe(Number(row.stock_qty));
        expect(row.movements, row.name).toBe(1);
        expect(row.created_by_owner, row.name).toBe(true);
        expect(Number(row.avg_cost), row.name).toBeGreaterThan(0);
      }
      const beans = rows.find((r) => r.name === "Biji kopi arabika")!;
      expect(beans).toMatchObject({
        stock_qty: "3250.000",
        avg_cost: "285.0000",
      });
    });
  });

  it("gives every menu item a recipe and the extra shot its 9 g of beans", async () => {
    await inRollback(async (tx) => {
      await seedDatabase(tx, input);
      const recipes = await tx.execute<{ item: string; lines: number }>(sql`
        select m.name as item, count(r.ingredient_id)::int as lines
        from menu_items m
        left join recipe_items r on r.menu_item_id = m.id
        group by m.name`);
      expect(recipes.every((row) => row.lines > 0)).toBe(true);
      expect(recipes).toHaveLength(data.menuItems.length);

      const deltas = await tx.execute<{
        option: string;
        ingredient: string;
        qty_delta: string;
      }>(sql`
        select o.name as option, i.name as ingredient, d.qty_delta
        from modifier_option_ingredients d
        join modifier_options o on o.id = d.option_id
        join ingredients i on i.id = d.ingredient_id
        order by o.name, i.name`);
      expect([...deltas]).toEqual([
        {
          option: "Extra shot",
          ingredient: "Biji kopi arabika",
          qty_delta: "9.000",
        },
        { option: "Large", ingredient: "Es batu", qty_delta: "50.000" },
        { option: "Susu oat", ingredient: "Oat milk", qty_delta: "150.000" },
        { option: "Susu oat", ingredient: "Susu UHT", qty_delta: "-150.000" },
      ]);
    });
  });

  it("keeps a recipe the owner changed when seeding again", async () => {
    await inRollback(async (tx) => {
      await seedDatabase(tx, input);
      const [latte] = await tx
        .select({ id: schema.menuItems.id })
        .from(schema.menuItems)
        .where(eq(schema.menuItems.name, "Latte"));
      const [line] = await tx
        .select()
        .from(schema.recipeItems)
        .where(eq(schema.recipeItems.menuItemId, latte!.id))
        .limit(1);
      await tx
        .delete(schema.recipeItems)
        .where(eq(schema.recipeItems.menuItemId, latte!.id));
      await tx.insert(schema.recipeItems).values({ ...line!, qty: "1.000" });

      const again = await seedDatabase(tx, input);
      expect(again.recipeItems).toBe(0);
      const lines = await tx
        .select()
        .from(schema.recipeItems)
        .where(eq(schema.recipeItems.menuItemId, latte!.id));
      expect(lines).toEqual([{ ...line!, qty: "1.000" }]);
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
