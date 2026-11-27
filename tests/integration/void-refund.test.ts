import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeSql, getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { randomToken } from "@/lib/ids";
import {
  elevate,
  ownerLogin,
  pinLogin,
  resetAuthRateLimits,
  type SessionUser,
} from "@/modules/auth/service";
import { createIngredient } from "@/modules/inventory/service";
import { setRecipe } from "@/modules/menu/service";
import {
  advanceOrderStatus,
  createCounterOrder,
  getOwnerOrder,
  listOwnerOrders,
  resetOrderRateLimits,
  voidOrder,
} from "@/modules/orders/service";
import {
  listRefunds,
  markRefundProcessed,
  mockPay,
} from "@/modules/payments/service";
import { createDevice, createUser, unique } from "./auth-fixtures";
import { createCatalog } from "./menu-fixtures";
import { stockLedgerMismatches } from "./stock-ledger";

// P3-01 (FR-PM-08, FR-IV-09, FR-OW-08, BR-07, BR-08; Schema §5.4).
// Acceptance: a void before preparing returns stock; a void after preparing
// logs waste; the refund shows until it is marked processed; every step is
// audited.

afterAll(() => closeSql());
beforeEach(() => {
  resetAuthRateLimits();
  resetOrderRateLimits();
});

const OWNER_PIN = "864213";
let owner: SessionUser;
let ownerName: string;
let staff: SessionUser;
let staffName: string;
let barista: SessionUser;
let catalog: Awaited<ReturnType<typeof createCatalog>>;
let beans: string;
let milk: string;
let kopi: string;

async function counterLogin(role: "staff" | "barista") {
  const row = await createUser({ role, pin: "135790" });
  const device = await createDevice();
  const login = await pinLogin({
    userId: row.id,
    pin: row.pin,
    deviceToken: device.token,
    ip: unique("ip"),
  });
  return { user: login.user, name: row.name };
}

async function ingredient(stock: number) {
  const { id } = await createIngredient(owner, {
    name: unique("Bahan"),
    kind: "raw",
    unit: "g",
    minStockQty: "0",
    isActive: true,
    opening: { quantity: String(stock), totalCost: stock * 100 },
  });
  return id;
}

beforeAll(async () => {
  const ownerRow = await createUser({ role: "owner", pin: OWNER_PIN });
  ownerName = ownerRow.name;
  ({ user: owner } = await ownerLogin({
    email: ownerRow.email!,
    password: ownerRow.password,
    ip: unique("ip"),
  }));
  ({ user: staff, name: staffName } = await counterLogin("staff"));
  ({ user: barista } = await counterLogin("barista"));
  catalog = await createCatalog();
  beans = await ingredient(1000);
  milk = await ingredient(5000);
  const [item] = await getDb()
    .insert(schema.menuItems)
    .values({
      categoryId: catalog.categories.drinks.id,
      name: unique("Kopi"),
      price: 25_000,
    })
    .returning();
  kopi = item!.id;
  await setRecipe(owner, kopi, [
    { ingredientId: beans, qty: "18" },
    { ingredientId: milk, qty: "150" },
  ]);
});

// A walk-in order for `quantity` Kopi, paid with the mock gateway.
async function paidOrder(quantity = 1) {
  const { order, payment } = await createCounterOrder(staff, {
    clientSession: randomToken(16),
    idempotencyKey: randomToken(16),
    items: [{ menuItemId: kopi, quantity, modifierOptionIds: [] }],
  });
  await mockPay(payment!.id);
  return { id: order.id, total: order.total, paymentId: payment!.id };
}

const ownerPin = (
  actor: SessionUser,
  scope: "void_order" | "refund_processed",
) => elevate(actor, { pin: OWNER_PIN, scope }).then((e) => e.elevationId);

const stockOf = async (id: string) =>
  (
    await getDb()
      .select({ stockQty: schema.ingredients.stockQty })
      .from(schema.ingredients)
      .where(eq(schema.ingredients.id, id))
  )[0]!.stockQty;

const movementsOf = (orderId: string) =>
  getDb()
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
    )
    .orderBy(schema.stockMovements.id);

const orderRow = async (id: string) =>
  (
    await getDb().select().from(schema.orders).where(eq(schema.orders.id, id))
  )[0]!;

const refundsOf = (orderId: string) =>
  getDb()
    .select()
    .from(schema.refunds)
    .where(eq(schema.refunds.orderId, orderId));

const auditsOf = (entityIds: string[]) =>
  getDb()
    .select()
    .from(schema.auditLogs)
    .where(inArray(schema.auditLogs.entityId, entityIds))
    .orderBy(schema.auditLogs.id);

describe("voidOrder (Schema §5.4)", () => {
  it("returns the stock of an order that was not started, and asks for a refund", async () => {
    const before = { beans: await stockOf(beans), milk: await stockOf(milk) };
    const order = await paidOrder(2);
    expect(await stockOf(beans)).not.toBe(before.beans);

    const elevationId = await ownerPin(staff, "void_order");
    const result = await voidOrder(staff, {
      orderId: order.id,
      reason: "changed_mind",
      note: "minta batal",
      elevationId,
    });
    expect(result).toMatchObject({
      status: "voided",
      stock: "returned",
      refund: { amount: order.total },
    });

    expect(await stockOf(beans)).toBe(before.beans);
    expect(await stockOf(milk)).toBe(before.milk);
    const moves = await movementsOf(order.id);
    expect(moves.map((m) => [m.ingredientId, m.type, m.qtyDelta])).toEqual(
      expect.arrayContaining([
        [beans, "sale_deduction", "-36.000"],
        [milk, "sale_deduction", "-300.000"],
        [beans, "void_return", "36.000"],
        [milk, "void_return", "300.000"],
      ]),
    );
    expect(moves).toHaveLength(4);
    expect(moves.filter((m) => m.type === "void_return")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ createdBy: staff.userId }),
      ]),
    );

    const row = await orderRow(order.id);
    expect(row).toMatchObject({
      status: "voided",
      voidedBy: staff.userId,
      voidReason: "Pelanggan berubah pikiran · minta batal",
    });
    expect(row.voidedAt).toBeInstanceOf(Date);

    const [refund] = await refundsOf(order.id);
    expect(refund).toMatchObject({
      paymentId: order.paymentId,
      amount: order.total,
      status: "requested",
      requestedBy: staff.userId,
      reason: "Pelanggan berubah pikiran · minta batal",
    });

    const audits = await auditsOf([order.id, refund!.id]);
    expect(audits.map((a) => a.action)).toEqual([
      "order.void",
      "refund.request",
    ]);
    expect(audits[0]).toMatchObject({
      actorUserId: staff.userId,
      reason: "Pelanggan berubah pikiran · minta batal",
      metadata: expect.objectContaining({
        fromStatus: "paid",
        stock: "returned",
        refundId: refund!.id,
        amount: order.total,
        elevationId,
        ownerUserId: owner.userId,
      }),
    });

    const [elevation] = await getDb()
      .select()
      .from(schema.elevations)
      .where(eq(schema.elevations.id, elevationId));
    expect(elevation!.usedAt).toBeInstanceOf(Date);
    expect(await stockLedgerMismatches()).toEqual([]);
  });

  it("logs the ingredients as waste once preparation started (BR-08)", async () => {
    const order = await paidOrder(1);
    await advanceOrderStatus(staff, { orderId: order.id, status: "preparing" });
    const afterSale = {
      beans: await stockOf(beans),
      milk: await stockOf(milk),
    };

    // The owner voids with their own PIN.
    const result = await voidOrder(owner, {
      orderId: order.id,
      reason: "cannot_make",
      elevationId: await ownerPin(owner, "void_order"),
    });
    expect(result.stock).toBe("wasted");

    expect(await stockOf(beans)).toBe(afterSale.beans);
    expect(await stockOf(milk)).toBe(afterSale.milk);
    const moves = await movementsOf(order.id);
    expect(moves.map((m) => [m.ingredientId, m.type, m.qtyDelta])).toEqual(
      expect.arrayContaining([
        [beans, "void_return", "18.000"],
        [beans, "waste", "-18.000"],
        [milk, "void_return", "150.000"],
        [milk, "waste", "-150.000"],
      ]),
    );
    expect(moves).toHaveLength(6);
    const [audit] = await auditsOf([order.id]);
    expect(audit!.metadata).toMatchObject({
      fromStatus: "preparing",
      stock: "wasted",
    });
    expect(await stockLedgerMismatches()).toEqual([]);
  });

  it("voids a ready order as waste too", async () => {
    const order = await paidOrder(1);
    await advanceOrderStatus(staff, { orderId: order.id, status: "preparing" });
    await advanceOrderStatus(staff, { orderId: order.id, status: "ready" });
    const result = await voidOrder(staff, {
      orderId: order.id,
      reason: "other",
      note: "Tumpah",
      elevationId: await ownerPin(staff, "void_order"),
    });
    expect(result.stock).toBe("wasted");
    expect((await orderRow(order.id)).voidReason).toBe("Tumpah");
  });

  it("refuses without the owner's PIN, for the barista, and for orders that are not queued", async () => {
    const order = await paidOrder(1);
    const input = { orderId: order.id, reason: "wrong_order" as const };

    await expect(
      voidOrder(barista, {
        ...input,
        elevationId: await ownerPin(barista, "void_order"),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      voidOrder(staff, { ...input, elevationId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "ELEVATION_REQUIRED" });
    // An elevation for another action does not count.
    await expect(
      voidOrder(staff, {
        ...input,
        elevationId: (
          await elevate(staff, { pin: OWNER_PIN, scope: "manual_payment" })
        ).elevationId,
      }),
    ).rejects.toMatchObject({ code: "ELEVATION_REQUIRED" });
    await expect(
      voidOrder(staff, {
        ...input,
        reason: "other",
        elevationId: await ownerPin(staff, "void_order"),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await orderRow(order.id)).status).toBe("paid");
    expect(await refundsOf(order.id)).toEqual([]);

    // One elevation, one use.
    const elevationId = await ownerPin(staff, "void_order");
    await voidOrder(staff, { ...input, elevationId });
    const other = await paidOrder(1);
    await expect(
      voidOrder(staff, { ...input, orderId: other.id, elevationId }),
    ).rejects.toMatchObject({ code: "ELEVATION_REQUIRED" });
    expect((await orderRow(other.id)).status).toBe("paid");
    // Voided already: the status changed.
    await expect(
      voidOrder(staff, {
        ...input,
        elevationId: await ownerPin(staff, "void_order"),
      }),
    ).rejects.toMatchObject({ code: "ORDER_STATUS_CHANGED" });
    expect(await refundsOf(order.id)).toHaveLength(1);

    // Unpaid orders are cancelled, not voided.
    const { order: unpaid } = await createCounterOrder(staff, {
      clientSession: randomToken(16),
      idempotencyKey: randomToken(16),
      items: [{ menuItemId: kopi, quantity: 1, modifierOptionIds: [] }],
    });
    await expect(
      voidOrder(staff, {
        orderId: unpaid.id,
        reason: "wrong_order",
        elevationId: await ownerPin(staff, "void_order"),
      }),
    ).rejects.toMatchObject({
      code: "ORDER_STATUS_CHANGED",
      details: { status: "awaiting_payment" },
    });
  });
});

describe("refunds (O-12, Schema §5.4 step 6)", () => {
  it("stays open until the owner marks it processed with their PIN", async () => {
    const order = await paidOrder(1);
    await voidOrder(staff, {
      orderId: order.id,
      reason: "double_payment",
      elevationId: await ownerPin(staff, "void_order"),
    });
    const [refund] = await refundsOf(order.id);

    const open = (await listRefunds(owner)).find((r) => r.id === refund!.id);
    expect(open).toMatchObject({
      status: "requested",
      source: "void",
      amount: order.total,
      reason: "Pembayaran ganda",
      requestedByName: staffName,
      approvedVoidBy: ownerName,
      stock: "returned",
      processedByName: null,
    });

    await expect(listRefunds(staff)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      markRefundProcessed(staff, {
        refundId: refund!.id,
        gatewayRef: "RFD-1",
        elevationId: await ownerPin(staff, "refund_processed"),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      markRefundProcessed(owner, {
        refundId: refund!.id,
        gatewayRef: "RFD-1",
        elevationId: await ownerPin(owner, "void_order"),
      }),
    ).rejects.toMatchObject({ code: "ELEVATION_REQUIRED" });

    const elevationId = await ownerPin(owner, "refund_processed");
    await markRefundProcessed(owner, {
      refundId: refund!.id,
      gatewayRef: "RFD-7Q2K91",
      elevationId,
    });
    const [done] = await refundsOf(order.id);
    expect(done).toMatchObject({
      status: "processed",
      approvedBy: owner.userId,
      gatewayRef: "RFD-7Q2K91",
    });
    expect(done!.processedAt).toBeInstanceOf(Date);
    const [payment] = await getDb()
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, order.paymentId));
    expect(payment!.status).toBe("refunded");
    const audits = await auditsOf([refund!.id]);
    expect(audits.map((a) => a.action)).toEqual([
      "refund.request",
      "refund.process",
    ]);
    expect(audits[1]).toMatchObject({
      actorUserId: owner.userId,
      metadata: expect.objectContaining({
        gatewayRef: "RFD-7Q2K91",
        elevationId,
        amount: order.total,
      }),
    });

    const listed = (await listRefunds(owner)).find((r) => r.id === refund!.id);
    expect(listed).toMatchObject({
      status: "processed",
      processedByName: ownerName,
      gatewayRef: "RFD-7Q2K91",
    });
    await expect(
      markRefundProcessed(owner, {
        refundId: refund!.id,
        gatewayRef: "RFD-2",
        elevationId: await ownerPin(owner, "refund_processed"),
      }),
    ).rejects.toMatchObject({ code: "REFUND_STATUS_CHANGED" });
  });
});

describe("owner orders (O-12, FR-OW-08)", () => {
  it("lists the day's orders with refund state, searchable by number", async () => {
    const order = await paidOrder(1);
    await voidOrder(staff, {
      orderId: order.id,
      reason: "wrong_order",
      elevationId: await ownerPin(staff, "void_order"),
    });
    const { queueNumber } = await orderRow(order.id);

    const list = await listOwnerOrders(owner, {});
    expect(list.date).toBe(list.today);
    expect(list.orders.find((o) => o.id === order.id)).toMatchObject({
      status: "voided",
      channel: "counter",
      total: order.total,
      payment: { method: "qris_dynamic", status: "paid" },
      refund: "requested",
    });

    const found = await listOwnerOrders(owner, { q: `#${queueNumber}` });
    expect(found.orders.map((o) => o.queueNumber)).toEqual([queueNumber]);

    const detail = await getOwnerOrder(owner, order.id);
    expect(detail).toMatchObject({
      status: "voided",
      voidReason: "Pesanan salah input",
      voidedByName: staffName,
      refunds: [expect.objectContaining({ status: "requested" })],
    });

    await expect(listOwnerOrders(staff, {})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      listOwnerOrders(owner, { date: "2999-01-01" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(getOwnerOrder(staff, order.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
