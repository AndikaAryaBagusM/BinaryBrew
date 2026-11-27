import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeSql, getDb } from "@/db/client";
import * as schema from "@/db/schema";
import {
  ownerLogin,
  pinLogin,
  resetAuthRateLimits,
  type SessionUser,
} from "@/modules/auth/service";
import { createIngredient } from "@/modules/inventory/service";
import {
  createModifierGroup,
  createModifierOption,
  setItemGroups,
  setRecipe,
  updateModifierOption,
} from "@/modules/menu/service";
import {
  cancelSelfOrder,
  createCounterOrder,
  createSelfOrder,
  expireOrder,
  resetOrderRateLimits,
} from "@/modules/orders/service";
import {
  confirmManualPayment,
  handlePaymentWebhook,
  signedMockPaidEvent,
} from "@/modules/payments/service";
import { createDevice, createUser, unique } from "./auth-fixtures";
import { createCatalog } from "./menu-fixtures";
import { stockLedgerMismatches } from "./stock-ledger";

// P2-04 (FR-IV-03, FR-HP-03, BR-05; Schema §5.2 step 6): a paid order takes
// its ingredients out of stock in the payment transaction and records each
// line's unit_cogs. Acceptance: 50 parallel paid orders leave stock_qty equal
// to the ledger sum; unpaid and expired orders never deduct.

afterAll(async () => {
  await getDb()
    .delete(schema.settings)
    .where(eq(schema.settings.key, "manual_payment_requires_owner_pin"));
  await closeSql();
});
beforeEach(() => {
  resetAuthRateLimits();
  resetOrderRateLimits();
});

let owner: SessionUser;
let staff: SessionUser;
let catalog: Awaited<ReturnType<typeof createCatalog>>;

beforeAll(async () => {
  const ownerRow = await createUser({ role: "owner" });
  owner = (
    await ownerLogin({
      email: ownerRow.email!,
      password: ownerRow.password,
      ip: unique("ip"),
    })
  ).user;
  const staffRow = await createUser({ role: "staff", pin: "975310" });
  const device = await createDevice();
  staff = (
    await pinLogin({
      userId: staffRow.id,
      pin: staffRow.pin,
      deviceToken: device.token,
      ip: unique("ip"),
    })
  ).user;
  catalog = await createCatalog();
});

// An ingredient with opening stock at a whole-rupiah unit cost (0 = no cost
// and no stock).
async function ingredient(name: string, stock: number, unitCost: number) {
  const { id } = await createIngredient(owner, {
    name: unique(name),
    kind: "raw",
    unit: "g",
    minStockQty: "0",
    isActive: true,
    opening:
      stock > 0
        ? { quantity: String(stock), totalCost: stock * unitCost }
        : null,
  });
  return id;
}

// Kopi: 18 g beans + 150 ml milk, with Extra shot (+9 g beans) and Susu oat
// (+150 ml oat, -150 ml milk).
async function kopiSetup(stock = { beans: 10_000, milk: 50_000, oat: 0 }) {
  const beans = await ingredient("Biji", stock.beans, 285);
  const milk = await ingredient("Susu", stock.milk, 20);
  const oat = await ingredient("Oat", stock.oat, 0);
  const [kopi] = await getDb()
    .insert(schema.menuItems)
    .values({
      categoryId: catalog.categories.drinks.id,
      name: unique("Kopi"),
      price: 25_000,
    })
    .returning();
  await setRecipe(owner, kopi!.id, [
    { ingredientId: beans, qty: "18" },
    { ingredientId: milk, qty: "150" },
  ]);
  const { id: groupId } = await createModifierGroup(owner, {
    name: unique("Tambahan"),
    minSelect: 0,
    maxSelect: 2,
    isActive: true,
  });
  const option = (
    name: string,
    deltas: { ingredientId: string; qtyDelta: string }[],
  ) =>
    createModifierOption(owner, groupId, {
      name,
      priceDelta: 0,
      isDefault: false,
      isActive: true,
      ingredientDeltas: deltas,
    }).then((row) => row.id);
  const shot = await option("Extra shot", [
    { ingredientId: beans, qtyDelta: "9" },
  ]);
  const oatOption = await option("Susu oat", [
    { ingredientId: oat, qtyDelta: "150" },
    { ingredientId: milk, qtyDelta: "-150" },
  ]);
  await setItemGroups(owner, kopi!.id, [groupId]);
  return { beans, milk, oat, kopi: kopi!, shot, oatOption };
}

type Line = {
  menuItemId: string;
  quantity: number;
  modifierOptionIds: string[];
};

function selfOrder(items: Line[], now = new Date()) {
  return createSelfOrder(
    {
      qrToken: catalog.qr.token,
      clientSession: randomBytes(16).toString("base64url"),
      idempotencyKey: randomBytes(16).toString("base64url"),
      items,
    },
    { now },
  );
}

async function pay(paymentId: string, now = new Date()) {
  const event = await signedMockPaidEvent(paymentId);
  return handlePaymentWebhook("mock", event.body, event.headers, { now });
}

async function stockOf(ids: string[]) {
  const rows = await getDb()
    .select({
      id: schema.ingredients.id,
      stockQty: schema.ingredients.stockQty,
    })
    .from(schema.ingredients)
    .where(inArray(schema.ingredients.id, ids));
  return Object.fromEntries(rows.map((row) => [row.id, row.stockQty]));
}

function movementsOf(orderId: string) {
  return getDb()
    .select({
      ingredientId: schema.stockMovements.ingredientId,
      type: schema.stockMovements.type,
      qtyDelta: schema.stockMovements.qtyDelta,
      createdBy: schema.stockMovements.createdBy,
    })
    .from(schema.stockMovements)
    .where(
      and(
        eq(schema.stockMovements.refType, "order"),
        eq(schema.stockMovements.refId, orderId),
      ),
    );
}

function cogsOf(orderId: string) {
  return getDb()
    .select({
      quantity: schema.orderItems.quantity,
      unitCogs: schema.orderItems.unitCogs,
    })
    .from(schema.orderItems)
    .where(eq(schema.orderItems.orderId, orderId))
    .orderBy(schema.orderItems.position);
}

describe("deduction at payment (FR-IV-03)", () => {
  it("takes recipe plus option deltas times quantity, one movement per ingredient", async () => {
    const s = await kopiSetup({ beans: 10_000, milk: 50_000, oat: 1000 });
    const { order, payment } = await selfOrder([
      { menuItemId: s.kopi.id, quantity: 2, modifierOptionIds: [s.shot] },
      { menuItemId: s.kopi.id, quantity: 1, modifierOptionIds: [s.oatOption] },
    ]);
    // Nothing leaves stock before payment (BR-05).
    expect(await movementsOf(order.id)).toEqual([]);

    expect((await pay(payment!.id)).outcome).toBe("paid");

    // Beans 2 × 27 + 18; milk 2 × 150 (the oat line uses none); oat 150.
    expect(await movementsOf(order.id)).toEqual(
      expect.arrayContaining([
        {
          ingredientId: s.beans,
          type: "sale_deduction",
          qtyDelta: "-72.000",
          createdBy: null,
        },
        {
          ingredientId: s.milk,
          type: "sale_deduction",
          qtyDelta: "-300.000",
          createdBy: null,
        },
        {
          ingredientId: s.oat,
          type: "sale_deduction",
          qtyDelta: "-150.000",
          createdBy: null,
        },
      ]),
    );
    expect(await movementsOf(order.id)).toHaveLength(3);
    expect(await stockOf([s.beans, s.milk, s.oat])).toEqual({
      [s.beans]: "9928.000",
      [s.milk]: "49700.000",
      [s.oat]: "850.000",
    });

    // FR-HP-03, by hand: 27 g × Rp 285 + 150 ml × Rp 20 = Rp 10.695;
    // 18 g × Rp 285 + 150 ml oat at no cost yet = Rp 5.130.
    expect(await cogsOf(order.id)).toEqual([
      { quantity: 2, unitCogs: 10_695 },
      { quantity: 1, unitCogs: 5130 },
    ]);
    expect(await stockLedgerMismatches()).toEqual([]);
  });

  it("uses the order's option snapshot and keeps unit_cogs when costs change", async () => {
    const s = await kopiSetup();
    const { order, payment } = await selfOrder([
      { menuItemId: s.kopi.id, quantity: 1, modifierOptionIds: [s.shot] },
    ]);
    // Edited after the order was placed: the order keeps +9 g.
    await updateModifierOption(owner, s.shot, {
      ingredientDeltas: [{ ingredientId: s.beans, qtyDelta: "30" }],
    });
    await pay(payment!.id);
    expect(await movementsOf(order.id)).toContainEqual(
      expect.objectContaining({ ingredientId: s.beans, qtyDelta: "-27.000" }),
    );
    // A later recipe change does not touch the stored HPP.
    await setRecipe(owner, s.kopi.id, [{ ingredientId: s.beans, qty: "40" }]);
    expect(await cogsOf(order.id)).toEqual([{ quantity: 1, unitCogs: 10_695 }]);
  });

  it("leaves stock alone and unit_cogs null for an item without a recipe", async () => {
    const { order, payment } = await selfOrder([
      {
        menuItemId: catalog.items.croissant.id,
        quantity: 2,
        modifierOptionIds: [],
      },
    ]);
    expect((await pay(payment!.id)).outcome).toBe("paid");
    expect(await movementsOf(order.id)).toEqual([]);
    expect(await cogsOf(order.id)).toEqual([{ quantity: 2, unitCogs: null }]);
  });

  it("lets stock go below zero: the sale already happened (BR-05)", async () => {
    const s = await kopiSetup({ beans: 20, milk: 50_000, oat: 0 });
    // Both orders fit at checkout; payment takes 36 g of 20 g.
    const first = await selfOrder([
      { menuItemId: s.kopi.id, quantity: 1, modifierOptionIds: [] },
    ]);
    const second = await selfOrder([
      { menuItemId: s.kopi.id, quantity: 1, modifierOptionIds: [] },
    ]);
    await pay(first.payment!.id);
    expect((await pay(second.payment!.id)).outcome).toBe("paid");
    expect((await stockOf([s.beans]))[s.beans]).toBe("-16.000");
    expect(await stockLedgerMismatches()).toEqual([]);
  });

  it("deducts on a manual confirmation", async () => {
    await getDb()
      .insert(schema.settings)
      .values({ key: "manual_payment_requires_owner_pin", value: false })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: false },
      });
    const s = await kopiSetup();
    const { order } = await createCounterOrder(staff, {
      clientSession: randomBytes(16).toString("base64url"),
      idempotencyKey: randomBytes(16).toString("base64url"),
      items: [{ menuItemId: s.kopi.id, quantity: 1, modifierOptionIds: [] }],
    });
    await confirmManualPayment(staff, { orderId: order.id, reference: "8812" });
    expect(await movementsOf(order.id)).toHaveLength(2);
  });
});

describe("orders that are not paid never deduct", () => {
  it("ignores a duplicate webhook", async () => {
    const s = await kopiSetup();
    const { order, payment } = await selfOrder([
      { menuItemId: s.kopi.id, quantity: 1, modifierOptionIds: [] },
    ]);
    const event = await signedMockPaidEvent(payment!.id);
    const first = await handlePaymentWebhook("mock", event.body, event.headers);
    const again = await handlePaymentWebhook("mock", event.body, event.headers);
    expect([first.outcome, again.outcome]).toEqual(["paid", "duplicate"]);
    // A second event for the same charge is "already paid".
    expect((await pay(payment!.id)).outcome).toBe("already_paid");
    expect(await movementsOf(order.id)).toHaveLength(2);
  });

  it("does not deduct for cancelled or expired orders, but does for a revival", async () => {
    const s = await kopiSetup();
    const line = [
      { menuItemId: s.kopi.id, quantity: 1, modifierOptionIds: [] },
    ];

    const cancelled = await selfOrder(line);
    await cancelSelfOrder(cancelled.order.publicToken);
    expect(await movementsOf(cancelled.order.id)).toEqual([]);

    const t0 = new Date(Date.now() - 30 * 60_000);
    const expire = async () => {
      const placed = await selfOrder(line, t0);
      await getDb().transaction((tx) =>
        expireOrder(placed.order.id, new Date(t0.getTime() + 15 * 60_000), tx),
      );
      return placed;
    };

    // Still available: a late payment revives the order and deducts.
    const revived = await expire();
    expect((await pay(revived.payment!.id)).outcome).toBe("revived");
    expect(await movementsOf(revived.order.id)).toHaveLength(2);

    // No serving left: refund requested, nothing deducted.
    const refunded = await expire();
    await setRecipe(owner, s.kopi.id, [
      { ingredientId: s.beans, qty: "20000" },
    ]);
    expect((await pay(refunded.payment!.id)).outcome).toBe("refund_requested");
    expect(await movementsOf(refunded.order.id)).toEqual([]);

    // Placed but never paid.
    await setRecipe(owner, s.kopi.id, [{ ingredientId: s.beans, qty: "18" }]);
    const unpaid = await selfOrder(line);
    expect(await movementsOf(unpaid.order.id)).toEqual([]);
  });
});

describe("50 parallel paid orders (P2-04 acceptance)", () => {
  it("leave stock_qty equal to the ledger sum", async () => {
    const s = await kopiSetup({ beans: 2000, milk: 10_000, oat: 0 });
    const orders = [];
    for (let i = 0; i < 50; i++) {
      orders.push(
        await createCounterOrder(staff, {
          clientSession: randomBytes(16).toString("base64url"),
          idempotencyKey: randomBytes(16).toString("base64url"),
          items: [
            {
              menuItemId: s.kopi.id,
              quantity: 1,
              modifierOptionIds: i % 2 === 0 ? [s.shot] : [],
            },
          ],
        }),
      );
    }
    const events = await Promise.all(
      orders.map(({ payment }) => signedMockPaidEvent(payment!.id)),
    );
    const results = await Promise.all(
      events.map((event) =>
        handlePaymentWebhook("mock", event.body, event.headers),
      ),
    );
    expect(results.every((result) => result.outcome === "paid")).toBe(true);

    // 25 × 27 g + 25 × 18 g = 1125 g of beans; 50 × 150 ml of milk.
    expect(await stockOf([s.beans, s.milk])).toEqual({
      [s.beans]: "875.000",
      [s.milk]: "2500.000",
    });
    expect(await stockLedgerMismatches()).toEqual([]);

    const queue = await getDb()
      .select({ number: schema.orders.queueNumber })
      .from(schema.orders)
      .where(
        inArray(
          schema.orders.id,
          orders.map(({ order }) => order.id),
        ),
      );
    expect(new Set(queue.map((row) => row.number)).size).toBe(50);
  });
});
