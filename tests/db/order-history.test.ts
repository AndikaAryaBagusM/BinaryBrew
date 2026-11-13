import { and, asc, eq, sql, TransactionRollbackError } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import type { DbTransaction } from "@/db/client";
import * as schema from "@/db/schema";
import { seedDatabase } from "@/db/seed/seed";
import { newSecretToken } from "@/lib/ids";
import {
  IMPORT_SESSION,
  importOrderHistory,
  SEED_SESSION,
  seedDemoOrders,
} from "@/modules/orders/service";
import { emptyTestDatabaseUrl } from "../integration/databases";

// FR-RC-07 (P1-14) on the empty test database: every test rolls back.

const client = postgres(emptyTestDatabaseUrl(process.env.TEST_DATABASE_URL!), {
  max: 1,
});
const db = drizzle(client, { schema });
afterAll(() => client.end());

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

const seedInput = {
  ownerEmail: "owner@test.local",
  ownerPassword: "correct horse battery",
  ownerPin: "135790",
  staffPin: "2468",
  counterDeviceToken: newSecretToken(),
  tokenHashPepper: "ab".repeat(32),
};

// 1 Nov 2026 12.00 in Jakarta.
const now = new Date("2026-11-01T05:00:00Z");
const endDate = "2026-10-31";

const { orders, orderItems, payments, queueCounters, menuItems } = schema;

function sessionOrders(tx: DbTransaction, clientSession: string) {
  return tx
    .select()
    .from(orders)
    .where(eq(orders.clientSession, clientSession))
    .orderBy(asc(orders.paidAt));
}

describe("seedDemoOrders (docs/06 §7)", () => {
  it("creates about 2,000 completed, paid seed orders over 60 days", async () => {
    await inRollback(async (tx) => {
      await seedDatabase(tx, seedInput);
      const result = await seedDemoOrders({ endDate }, { now, db: tx });
      expect(result).toMatchObject({
        status: "created",
        replaced: 0,
        firstDate: "2026-09-02",
        lastDate: endDate,
      });
      if (result.status !== "created") return;
      expect(result.created).toBeGreaterThanOrEqual(1900);
      expect(result.created).toBeLessThanOrEqual(2100);
      for (const rule of result.rules) {
        expect(Math.abs(rule.confidence - rule.targetConfidence)).toBeLessThan(
          0.03,
        );
      }

      const seeded = await sessionOrders(tx, SEED_SESSION);
      expect(seeded).toHaveLength(result.created);
      expect(
        seeded.every(
          (o) =>
            o.isSeed &&
            o.status === "completed" &&
            o.paidAt! < o.preparingAt! &&
            o.completedAt! > o.readyAt! &&
            o.total > 0,
        ),
      ).toBe(true);
      const days = new Set(seeded.map((o) => o.businessDate));
      expect(days.size).toBe(60);

      // Queue numbers run 1..n per day in payment order, as the counter says.
      const counters = new Map(
        (await tx.select().from(queueCounters)).map((c) => [
          c.businessDate,
          c.lastNumber,
        ]),
      );
      for (const day of days) {
        const numbers = seeded
          .filter((o) => o.businessDate === day)
          .map((o) => o.queueNumber);
        expect(numbers).toEqual(numbers.map((_, i) => i + 1));
        expect(counters.get(day)).toBe(numbers.length);
      }

      // One paid QRIS payment per order, for its total.
      const [mismatch] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from ${orders} o
        left join ${payments} p on p.order_id = o.id
          and p.status = 'paid' and p.amount = o.total and p.provider = 'seed'
        where o.client_session = ${SEED_SESSION} and p.id is null`);
      expect(mismatch?.n).toBe(0);

      // Lines carry the current menu prices.
      const [wrongPrice] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from ${orderItems} i
        join ${menuItems} m on m.id = i.menu_item_id
        join ${orders} o on o.id = i.order_id
        where o.client_session = ${SEED_SESSION} and i.unit_price <> m.price`);
      expect(wrongPrice?.n).toBe(0);
    });
  });

  it("refuses a second set unless asked to replace it, keeping other orders", async () => {
    await inRollback(async (tx) => {
      await seedDatabase(tx, seedInput);
      await seedDemoOrders({ endDate }, { now, db: tx });
      // An imported order on a seeded day takes the next number.
      await importOrderHistory(
        "order_ref,paid_at,item_name,quantity\nOLD-1,2026-10-31 23:00,Latte,1",
        { now, db: tx },
      );
      const [old] = await sessionOrders(tx, IMPORT_SESSION);
      const lastDay = (await sessionOrders(tx, SEED_SESSION)).filter(
        (o) => o.businessDate === endDate,
      );
      expect(old!.queueNumber).toBe(lastDay.length + 1);

      expect(await seedDemoOrders({ endDate }, { now, db: tx })).toEqual({
        status: "exists",
        existing: expect.any(Number),
      });

      const replaced = await seedDemoOrders(
        { endDate, replace: true },
        { now, db: tx },
      );
      expect(replaced).toMatchObject({
        status: "created",
        replaced: replaced.status === "created" ? replaced.created : -1,
      });
      // The imported order is untouched; the seed numbers follow it.
      expect(await sessionOrders(tx, IMPORT_SESSION)).toEqual([old]);
      const again = (await sessionOrders(tx, SEED_SESSION)).filter(
        (o) => o.businessDate === endDate,
      );
      expect(Math.min(...again.map((o) => o.queueNumber!))).toBe(
        old!.queueNumber! + 1,
      );
      const [seedPayments] = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from ${payments} where provider = 'seed'`,
      );
      expect(seedPayments?.n).toBe(
        replaced.status === "created" ? replaced.created : -1,
      );
    });
  });

  it("starts each day again at 1 after replacing on its own", async () => {
    await inRollback(async (tx) => {
      await seedDatabase(tx, seedInput);
      await seedDemoOrders({ endDate }, { now, db: tx });
      await seedDemoOrders({ endDate, replace: true }, { now, db: tx });
      const [first] = await tx
        .select({ queueNumber: orders.queueNumber })
        .from(orders)
        .where(
          and(
            eq(orders.clientSession, SEED_SESSION),
            eq(orders.businessDate, endDate),
          ),
        )
        .orderBy(asc(orders.paidAt))
        .limit(1);
      expect(first?.queueNumber).toBe(1);
    });
  });

  it("refuses an end date that is not before the current business day", async () => {
    await inRollback(async (tx) => {
      await seedDatabase(tx, seedInput);
      await expect(
        seedDemoOrders({ endDate: "2026-11-01" }, { now, db: tx }),
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        details: { reason: "end_date_not_past" },
      });
    });
  });

  it("refuses without the demo menu, tables and staff", async () => {
    await inRollback(async (tx) => {
      await expect(
        seedDemoOrders({ endDate }, { now, db: tx }),
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        details: { reason: "demo_data_missing", tables: 0, staff: 0 },
      });
    });
  });
});

describe("importOrderHistory", () => {
  const csv = [
    "order_ref,paid_at,item_name,quantity,unit_price",
    "A-1,2026-08-01 09:15,kopi susu gula aren,2,17.000",
    "A-1,2026-08-01 09:15,Croissant,1,",
    "A-2,2026-08-01T10:00:00+07:00,Latte,1,Rp 20.000",
  ].join("\r\n");

  it("imports counter orders taken by the owner, without tax or payment", async () => {
    await inRollback(async (tx) => {
      await seedDatabase(tx, seedInput);
      expect(await importOrderHistory(csv, { now, db: tx })).toEqual({
        status: "imported",
        orders: 2,
        lines: 3,
        skipped: 0,
      });
      const [croissant] = await tx
        .select({ price: menuItems.price })
        .from(menuItems)
        .where(eq(menuItems.name, "Croissant"));
      const [owner] = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.role, "owner"));
      const imported = await sessionOrders(tx, IMPORT_SESSION);
      expect(imported).toMatchObject([
        {
          idempotencyKey: "A-1",
          businessDate: "2026-08-01",
          queueNumber: 1,
          channel: "counter",
          status: "completed",
          createdBy: owner!.id,
          isSeed: true,
          subtotal: 34000 + croissant!.price,
          taxAmount: 0,
          serviceCharge: 0,
          total: 34000 + croissant!.price,
          paidAt: new Date("2026-08-01T02:15:00Z"),
          completedAt: new Date("2026-08-01T02:15:00Z"),
          preparingAt: null,
        },
        { idempotencyKey: "A-2", queueNumber: 2, total: 20000 },
      ]);
      const lines = await tx
        .select({
          name: orderItems.nameSnapshot,
          unitPrice: orderItems.unitPrice,
          quantity: orderItems.quantity,
          lineTotal: orderItems.lineTotal,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, imported[0]!.id))
        .orderBy(asc(orderItems.position));
      expect(lines).toEqual([
        {
          name: "Kopi Susu Gula Aren",
          unitPrice: 17000,
          quantity: 2,
          lineTotal: 34000,
        },
        {
          name: "Croissant",
          unitPrice: croissant!.price,
          quantity: 1,
          lineTotal: croissant!.price,
        },
      ]);
      const [paymentCount] = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from ${payments}`,
      );
      expect(paymentCount?.n).toBe(0);
    });
  });

  it("skips orders imported before, so a file can be imported again", async () => {
    await inRollback(async (tx) => {
      await seedDatabase(tx, seedInput);
      await importOrderHistory(csv, { now, db: tx });
      const more = `${csv}\r\nA-3,2026-08-02 08:00,Latte,1,`;
      expect(await importOrderHistory(more, { now, db: tx })).toEqual({
        status: "imported",
        orders: 1,
        lines: 1,
        skipped: 2,
      });
      expect(await sessionOrders(tx, IMPORT_SESSION)).toHaveLength(3);
    });
  });

  it("writes nothing for a dry run or a file with a bad row", async () => {
    await inRollback(async (tx) => {
      await seedDatabase(tx, seedInput);
      expect(
        await importOrderHistory(csv, { now, dryRun: true, db: tx }),
      ).toEqual({ status: "checked", orders: 2, lines: 3, skipped: 0 });
      const bad = `${csv}\r\nA-4,2026-08-02 08:00,Cappuccino,1,`;
      expect(await importOrderHistory(bad, { now, db: tx })).toEqual({
        status: "invalid",
        problems: [{ line: 5, message: 'unknown menu item "Cappuccino"' }],
      });
      expect(await sessionOrders(tx, IMPORT_SESSION)).toEqual([]);
      expect(await tx.select().from(queueCounters)).toEqual([]);
    });
  });
});
