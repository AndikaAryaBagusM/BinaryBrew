import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { closeSql, getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { randomToken } from "@/lib/ids";
import { subscribeToOrderEvents } from "@/modules/orders/events";
import {
  completeStaleReadyOrders,
  createSelfOrder,
  expireOverdueOrders,
  resetOrderRateLimits,
} from "@/modules/orders/service";
import { getPaymentProvider, mockPay } from "@/modules/payments/service";
import { runWorkerTick } from "@/modules/worker/service";
import { createCatalog } from "./menu-fixtures";

// P1-09 (FR-PM-04, FR-QF-05, Schema §5.3): the worker expires unpaid orders
// once their time is up (pending charge expired and cancelled at the
// provider) and completes Ready orders nobody collected.
//
// Integration files share one database, so other files' leftover orders may
// be swept too: assertions look at this file's orders only.

afterAll(() => closeSql());

let catalog: Awaited<ReturnType<typeof createCatalog>>;
beforeAll(async () => {
  catalog = await createCatalog();
});
beforeEach(async () => {
  resetOrderRateLimits();
  // A short expiry, as in the acceptance test.
  await getDb()
    .insert(schema.settings)
    .values({ key: "order_expiry_minutes", value: 1 })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: 1 } });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await getDb()
    .delete(schema.settings)
    .where(
      inArray(schema.settings.key, [
        "order_expiry_minutes",
        "ready_auto_complete_minutes",
      ]),
    );
});

// Own business days (queue counters persist across files).
let dayOffset = 0;
const freshDay = () =>
  new Date(Date.UTC(2300, 0, 1, 5) + dayOffset++ * 86_400_000);
const later = (at: Date, ms: number) => new Date(at.getTime() + ms);
const MINUTE = 60_000;

async function placeOrder(now: Date) {
  return createSelfOrder(
    {
      qrToken: catalog.qr.token,
      clientSession: randomToken(16),
      idempotencyKey: randomToken(16),
      items: [
        {
          menuItemId: catalog.items.croissant.id,
          quantity: 1,
          modifierOptionIds: [],
        },
      ],
    },
    { now },
  );
}

const orderRow = async (id: string) =>
  (
    await getDb().select().from(schema.orders).where(eq(schema.orders.id, id))
  )[0]!;
const paymentRow = async (id: string) =>
  (
    await getDb()
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.id, id))
  )[0]!;

// What the Counter (P1-10) does: paid → preparing → ready.
async function makeReady(orderId: string, readyAt: Date) {
  await getDb()
    .update(schema.orders)
    .set({ status: "ready", preparingAt: readyAt, readyAt })
    .where(eq(schema.orders.id, orderId));
}

describe("expireOverdueOrders (FR-PM-04)", () => {
  it("expires an unpaid order after its time, with its charge, cancelled at the provider", async () => {
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    expect(order.expiresAt).toEqual(later(now, MINUTE));
    const cancel = vi.spyOn(getPaymentProvider(), "cancelCharge");
    const { providerRef } = await paymentRow(payment!.id);

    const events: unknown[] = [];
    const unsubscribe = await subscribeToOrderEvents((e) => events.push(e));
    try {
      const swept = await expireOverdueOrders({ now: later(now, MINUTE) });
      expect(swept).toContain(order.id);
      await expect
        .poll(() =>
          events.some((e) => (e as { orderId: string }).orderId === order.id),
        )
        .toBe(true);
    } finally {
      await unsubscribe();
    }

    expect(await orderRow(order.id)).toMatchObject({
      status: "expired",
      queueNumber: null,
      paidAt: null,
    });
    expect((await paymentRow(payment!.id)).status).toBe("expired");
    expect(cancel).toHaveBeenCalledWith(providerRef);
    expect(events).toContainEqual({
      orderId: order.id,
      status: "expired",
      queueNumber: null,
    });
  });

  it("leaves orders whose time is not up, and orders already paid", async () => {
    const now = freshDay();
    const waiting = await placeOrder(now);
    const paid = await placeOrder(now);
    await mockPay(paid.payment!.id, { now: later(now, 10_000) });

    const swept = await expireOverdueOrders({
      now: later(now, MINUTE - 1),
    });
    expect(swept).not.toContain(waiting.order.id);
    expect((await orderRow(waiting.order.id)).status).toBe("awaiting_payment");

    const afterwards = await expireOverdueOrders({ now: later(now, MINUTE) });
    expect(afterwards).toContain(waiting.order.id);
    expect(afterwards).not.toContain(paid.order.id);
    expect(await orderRow(paid.order.id)).toMatchObject({
      status: "paid",
      queueNumber: 1,
    });
  });

  it("is safe to run twice", async () => {
    const now = freshDay();
    const { order } = await placeOrder(now);
    const cancel = vi.spyOn(getPaymentProvider(), "cancelCharge");
    expect(await expireOverdueOrders({ now: later(now, MINUTE) })).toContain(
      order.id,
    );
    expect(
      await expireOverdueOrders({ now: later(now, MINUTE) }),
    ).not.toContain(order.id);
    expect(
      cancel.mock.calls.filter(([ref]) => ref === cancel.mock.calls[0]![0]),
    ).toHaveLength(1);
  });

  it("racing a payment, the order still ends paid with one queue number", async () => {
    const now = freshDay();
    const placed = await Promise.all(
      Array.from({ length: 10 }, () => placeOrder(now)),
    );
    const at = later(now, MINUTE);
    await Promise.all([
      expireOverdueOrders({ now: at }),
      ...placed.map(({ payment }) => mockPay(payment!.id, { now: at })),
    ]);
    // Paid first, or expired first and revived by the late payment.
    for (const { order, payment } of placed) {
      const row = await orderRow(order.id);
      expect(row.status).toBe("paid");
      expect(row.queueNumber).not.toBeNull();
      expect((await paymentRow(payment!.id)).status).toBe("paid");
    }
    const numbers = (
      await Promise.all(placed.map(({ order }) => orderRow(order.id)))
    ).map((row) => row.queueNumber);
    expect(new Set(numbers).size).toBe(10);
  });

  it("expires an order whose charge was never created", async () => {
    const now = freshDay();
    const [order] = await getDb()
      .insert(schema.orders)
      .values({
        publicToken: randomToken(16),
        businessDate: "2300-06-01",
        channel: "self_order",
        qrTokenId: catalog.qr.id,
        clientSession: randomToken(16),
        subtotal: 18_000,
        total: 18_000,
        expiresAt: later(now, MINUTE),
      })
      .returning();
    expect(await expireOverdueOrders({ now: later(now, MINUTE) })).toContain(
      order!.id,
    );
    expect((await orderRow(order!.id)).status).toBe("expired");
  });
});

describe("completeStaleReadyOrders (FR-QF-05)", () => {
  it("completes a Ready order after ready_auto_complete_minutes, not before", async () => {
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    await mockPay(payment!.id, { now });
    const readyAt = later(now, 5 * MINUTE);
    await makeReady(order.id, readyAt);

    expect(
      await completeStaleReadyOrders({ now: later(readyAt, 30 * MINUTE - 1) }),
    ).not.toContain(order.id);
    expect((await orderRow(order.id)).status).toBe("ready");

    const events: unknown[] = [];
    const unsubscribe = await subscribeToOrderEvents((e) => events.push(e));
    const at = later(readyAt, 30 * MINUTE);
    try {
      expect(await completeStaleReadyOrders({ now: at })).toContain(order.id);
      await expect
        .poll(() =>
          events.some((e) => (e as { orderId: string }).orderId === order.id),
        )
        .toBe(true);
    } finally {
      await unsubscribe();
    }
    expect(await orderRow(order.id)).toMatchObject({
      status: "completed",
      completedAt: at,
      queueNumber: 1,
    });
    expect(events).toContainEqual({
      orderId: order.id,
      status: "completed",
      queueNumber: 1,
    });
  });

  it("uses the current setting", async () => {
    await getDb()
      .insert(schema.settings)
      .values({ key: "ready_auto_complete_minutes", value: 5 });
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    await mockPay(payment!.id, { now });
    await makeReady(order.id, now);
    expect(
      await completeStaleReadyOrders({ now: later(now, 5 * MINUTE) }),
    ).toContain(order.id);
  });

  it("leaves paid and preparing orders alone", async () => {
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    await mockPay(payment!.id, { now });
    expect(
      await completeStaleReadyOrders({ now: later(now, 24 * 60 * MINUTE) }),
    ).not.toContain(order.id);
    expect((await orderRow(order.id)).status).toBe("paid");
  });
});

describe("runWorkerTick", () => {
  it("runs both sweeps and reports what changed", async () => {
    const now = freshDay();
    const unpaid = await placeOrder(now);
    const collected = await placeOrder(now);
    await mockPay(collected.payment!.id, { now });
    await makeReady(collected.order.id, now);

    const result = await runWorkerTick({ now: later(now, 30 * MINUTE) });
    expect(result.expired).toContain(unpaid.order.id);
    expect(result.completed).toContain(collected.order.id);
    // Noon in Jakarta: outside the nightly recommendation window.
    expect(result.recommendationRunStarted).toBe(false);
  });
});
