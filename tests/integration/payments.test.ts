import { and, eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as mockPayPost } from "@/app/api/dev/mock-pay/[paymentId]/route";
import { POST as webhookPost } from "@/app/api/webhooks/payments/[provider]/route";
import { closeSql, getDb, getSql } from "@/db/client";
import * as schema from "@/db/schema";
import { getEnv } from "@/lib/env";
import { randomToken } from "@/lib/ids";
import { businessDate } from "@/lib/time";
import {
  createSelfOrder,
  resetOrderRateLimits,
} from "@/modules/orders/service";
import { signMockEvent } from "@/modules/payments/providers/mock";
import { handlePaymentWebhook, mockPay } from "@/modules/payments/service";
import { createCatalog } from "./menu-fixtures";

// P1-07 (FR-PM-01..03, FR-PM-07, BR-04, Schema §5.2): a verified, idempotent
// payment webhook marks the order paid and gives it the next queue number of
// its business day; a late payment revives the order or requests a refund.

afterAll(() => closeSql());

let catalog: Awaited<ReturnType<typeof createCatalog>>;
beforeAll(async () => {
  catalog = await createCatalog();
});
beforeEach(async () => {
  resetOrderRateLimits();
  await getDb()
    .delete(schema.settings)
    .where(
      inArray(schema.settings.key, [
        "ordering_enabled",
        "tax_rate_bps",
        "service_charge_bps",
        "order_expiry_minutes",
      ]),
    );
});

// Queue numbers count per business day and the counter rows stay behind, so
// each test orders on its own day (12.00 in Jakarta, far from the cutoff).
let dayOffset = 0;
const freshDay = () =>
  new Date(Date.UTC(2100, 0, 1, 5) + dayOffset++ * 86_400_000);
const later = (at: Date, minutes: number) =>
  new Date(at.getTime() + minutes * 60_000);

const secret = () => getEnv().PAYMENT_WEBHOOK_SECRET;

async function placeOrder(
  now: Date,
  items = [
    {
      menuItemId: catalog.items.americano.id,
      quantity: 1,
      modifierOptionIds: [] as string[],
    },
  ],
) {
  return createSelfOrder(
    {
      qrToken: catalog.qr.token,
      clientSession: randomToken(16),
      idempotencyKey: randomToken(16),
      items,
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
const refundsOf = (orderId: string) =>
  getDb()
    .select()
    .from(schema.refunds)
    .where(eq(schema.refunds.orderId, orderId));

// A signed "paid" event for a payment, as the gateway would send it.
async function paidEvent(paymentId: string, eventId = randomToken(16)) {
  const { providerRef } = await paymentRow(paymentId);
  return signMockEvent(secret(), {
    eventId,
    providerRef: providerRef!,
    type: "paid",
  });
}

// What the expiry sweep (P1-09) will do: order and pending payment expire.
async function expire(orderId: string, paymentId: string) {
  await getDb()
    .update(schema.orders)
    .set({ status: "expired" })
    .where(eq(schema.orders.id, orderId));
  await getDb()
    .update(schema.payments)
    .set({ status: "expired" })
    .where(eq(schema.payments.id, paymentId));
}

describe("QRIS charge at checkout (FR-PM-01, FR-PM-02)", () => {
  it("creates one pending charge for the exact total and the order's deadline", async () => {
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    expect(payment).toMatchObject({
      amount: order.total,
      expiresAt: order.expiresAt,
    });
    expect(payment!.qrString).not.toBe("");

    const rows = await getDb()
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, order.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: payment!.id,
      method: "qris_dynamic",
      status: "pending",
      amount: order.total,
      provider: "mock",
      qrString: payment!.qrString,
      expiresAt: order.expiresAt,
      paidAt: null,
    });
    expect(rows[0]!.providerRef).toMatch(/^mock_/);
  });

  it("returns the same charge when the order request is retried", async () => {
    const now = freshDay();
    const request = {
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
    };
    const first = await createSelfOrder(request, { now });
    const retries = await Promise.all(
      Array.from({ length: 5 }, () => createSelfOrder(request, { now })),
    );
    for (const retry of retries) expect(retry.payment).toEqual(first.payment);
    const rows = await getDb()
      .select()
      .from(schema.payments)
      .where(eq(schema.payments.orderId, first.order.id));
    expect(rows).toHaveLength(1);
  });
});

describe("handlePaymentWebhook: paid (Schema §5.2)", () => {
  it("marks the payment and order paid with the first queue number of the day", async () => {
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    const paidAt = later(now, 2);
    const { body, headers } = await paidEvent(payment!.id);

    const result = await handlePaymentWebhook("mock", body, headers, {
      now: paidAt,
    });
    expect(result.outcome).toBe("paid");

    expect(await paymentRow(payment!.id)).toMatchObject({
      status: "paid",
      paidAt,
    });
    expect(await orderRow(order.id)).toMatchObject({
      status: "paid",
      paidAt,
      queueNumber: 1,
      businessDate: businessDate(now),
    });
  });

  it("processes a duplicate event once (FR-PM-03)", async () => {
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    const event = await paidEvent(
      payment!.id,
      "evt-duplicate-" + randomToken(16),
    );

    const first = await handlePaymentWebhook(
      "mock",
      event.body,
      event.headers,
      {
        now: later(now, 1),
      },
    );
    const again = await handlePaymentWebhook(
      "mock",
      event.body,
      event.headers,
      {
        now: later(now, 3),
      },
    );
    expect(first.outcome).toBe("paid");
    expect(again.outcome).toBe("duplicate");

    const row = await orderRow(order.id);
    expect(row).toMatchObject({ queueNumber: 1, paidAt: later(now, 1) });
    const [counter] = await getDb()
      .select()
      .from(schema.queueCounters)
      .where(eq(schema.queueCounters.businessDate, row.businessDate));
    expect(counter!.lastNumber).toBe(1);

    const events = await getDb()
      .select()
      .from(schema.paymentEvents)
      .where(
        and(
          eq(schema.paymentEvents.provider, "mock"),
          eq(schema.paymentEvents.eventId, JSON.parse(event.body).eventId),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ outcome: "paid" });
    expect(events[0]!.processedAt).not.toBeNull();
  });

  it("processes the same event delivered in parallel once", async () => {
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    const event = await paidEvent(payment!.id);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        handlePaymentWebhook("mock", event.body, event.headers, {
          now: later(now, 1),
        }),
      ),
    );
    expect(results.map((r) => r.outcome).sort()).toEqual([
      "duplicate",
      "duplicate",
      "duplicate",
      "duplicate",
      "paid",
    ]);
    expect((await orderRow(order.id)).queueNumber).toBe(1);
  });

  it("ignores a second, different paid event for an order already paid", async () => {
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    await mockPay(payment!.id, { now: later(now, 1) });
    const result = await mockPay(payment!.id, { now: later(now, 2) });
    expect(result.outcome).toBe("already_paid");
    expect(await orderRow(order.id)).toMatchObject({
      queueNumber: 1,
      paidAt: later(now, 1),
    });
  });

  it("gives 50 parallel payments unique, gapless queue numbers (BR-04)", async () => {
    const now = freshDay();
    const placed = [];
    for (let i = 0; i < 50; i++) placed.push(await placeOrder(now));

    const results = await Promise.all(
      placed.map(({ payment }) => mockPay(payment!.id, { now: later(now, 1) })),
    );
    expect(results.every((r) => r.outcome === "paid")).toBe(true);

    const rows = await getDb()
      .select({ queueNumber: schema.orders.queueNumber })
      .from(schema.orders)
      .where(
        inArray(
          schema.orders.id,
          placed.map(({ order }) => order.id),
        ),
      );
    expect(rows.map((r) => r.queueNumber).sort((a, b) => a! - b!)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
  });

  it("keeps counting per business day", async () => {
    const day = freshDay();
    const nextDay = freshDay();
    const a = await placeOrder(day);
    const b = await placeOrder(nextDay);
    const c = await placeOrder(day);
    for (const { payment } of [a, b, c]) {
      await mockPay(payment!.id, { now: later(day, 1) });
    }
    expect((await orderRow(a.order.id)).queueNumber).toBe(1);
    expect((await orderRow(b.order.id)).queueNumber).toBe(1);
    expect((await orderRow(c.order.id)).queueNumber).toBe(2);
  });

  it("never gives an unpaid order a queue number", async () => {
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    for (const type of ["expired", "failed"] as const) {
      const { providerRef } = await paymentRow(payment!.id);
      const event = signMockEvent(secret(), {
        eventId: randomToken(16),
        providerRef: providerRef!,
        type,
      });
      const result = await handlePaymentWebhook(
        "mock",
        event.body,
        event.headers,
        {
          now: later(now, 1),
        },
      );
      expect(result.outcome).toBe("noted");
    }
    expect(await orderRow(order.id)).toMatchObject({
      status: "awaiting_payment",
      queueNumber: null,
      paidAt: null,
    });
    expect((await paymentRow(payment!.id)).status).toBe("pending");

    // The database refuses a number without payment (orders_queue_number_iff_paid).
    await expect(
      getDb()
        .update(schema.orders)
        .set({ queueNumber: 99 })
        .where(eq(schema.orders.id, order.id)),
    ).rejects.toThrow();
  });

  it("emits order.paid on order_events after commit", async () => {
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    const received: unknown[] = [];
    const listener = await getSql().listen("order_events", (payload) => {
      received.push(JSON.parse(payload));
    });
    try {
      await mockPay(payment!.id, { now: later(now, 1) });
      await expect.poll(() => received.length).toBeGreaterThan(0);
    } finally {
      await listener.unlisten();
    }
    // Tech §7: minimal; listeners refetch details.
    expect(received).toContainEqual({
      orderId: order.id,
      status: "paid",
      queueNumber: 1,
    });
  });
});

describe("handlePaymentWebhook: late payment (FR-PM-07)", () => {
  it("revives an expired order when its items are still available", async () => {
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    await expire(order.id, payment!.id);

    const result = await mockPay(payment!.id, { now: later(now, 15) });
    expect(result.outcome).toBe("revived");
    expect(await orderRow(order.id)).toMatchObject({
      status: "paid",
      queueNumber: 1,
      paidAt: later(now, 15),
    });
    expect((await paymentRow(payment!.id)).status).toBe("paid");
    expect(await refundsOf(order.id)).toEqual([]);
  });

  it("requests a refund and alerts the owner when an item has sold out", async () => {
    const now = freshDay();
    const [item] = await getDb()
      .insert(schema.menuItems)
      .values({
        categoryId: catalog.categories.drinks.id,
        name: "Es Kopi Susu " + randomToken(16),
        price: 23_000,
      })
      .returning();
    const { order, payment } = await placeOrder(now, [
      { menuItemId: item!.id, quantity: 2, modifierOptionIds: [] },
    ]);
    await expire(order.id, payment!.id);
    await getDb()
      .update(schema.menuItems)
      .set({ manualSoldOut: true })
      .where(eq(schema.menuItems.id, item!.id));

    const result = await mockPay(payment!.id, { now: later(now, 15) });
    expect(result.outcome).toBe("refund_requested");

    expect(await orderRow(order.id)).toMatchObject({
      status: "expired",
      queueNumber: null,
      paidAt: null,
    });
    expect(await paymentRow(payment!.id)).toMatchObject({
      status: "paid",
      paidAt: later(now, 15),
    });
    const refunds = await refundsOf(order.id);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      paymentId: payment!.id,
      amount: 46_000,
      status: "requested",
      reason: "paid after expiry, item unavailable",
      requestedBy: null,
      approvedBy: null,
    });

    const audits = await getDb()
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, "refund.request"),
          eq(schema.auditLogs.entityId, refunds[0]!.id),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: null,
      entityType: "refund",
      reason: "paid after expiry, item unavailable",
    });
    expect(audits[0]!.metadata).toMatchObject({
      orderId: order.id,
      paymentId: payment!.id,
      amount: 46_000,
    });

    // A repeated late event changes nothing more.
    const again = await mockPay(payment!.id, { now: later(now, 16) });
    expect(again.outcome).toBe("already_paid");
    expect(await refundsOf(order.id)).toHaveLength(1);
  });
});

describe("handlePaymentWebhook: refusals and unknowns", () => {
  it("refuses a bad signature and records nothing", async () => {
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    const event = await paidEvent(payment!.id);
    const forged = signMockEvent("cd".repeat(32), JSON.parse(event.body));

    await expect(
      handlePaymentWebhook("mock", forged.body, forged.headers, { now }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const events = await getDb()
      .select()
      .from(schema.paymentEvents)
      .where(eq(schema.paymentEvents.eventId, JSON.parse(event.body).eventId));
    expect(events).toEqual([]);
    expect((await orderRow(order.id)).status).toBe("awaiting_payment");
  });

  it("refuses a provider other than the configured one", async () => {
    const now = freshDay();
    const { payment } = await placeOrder(now);
    const event = await paidEvent(payment!.id);
    await expect(
      handlePaymentWebhook("midtrans", event.body, event.headers, { now }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("records an unknown reference and answers success so the gateway stops", async () => {
    const event = signMockEvent(secret(), {
      eventId: randomToken(16),
      providerRef: "mock_unknown_" + randomToken(16),
      type: "paid",
    });
    const result = await handlePaymentWebhook(
      "mock",
      event.body,
      event.headers,
      {
        now: freshDay(),
      },
    );
    expect(result.outcome).toBe("unknown_reference");
    const [row] = await getDb()
      .select()
      .from(schema.paymentEvents)
      .where(eq(schema.paymentEvents.eventId, JSON.parse(event.body).eventId));
    expect(row).toMatchObject({ outcome: "unknown_reference" });
  });

  it("mockPay refuses an unknown payment id", async () => {
    await expect(
      mockPay("8d5b7c1e-0000-4000-8000-00000000dead", { now: freshDay() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("routes", () => {
  const origin = "http://localhost:3000";

  function webhookRequest(provider: string, body: string, headers: Headers) {
    return webhookPost(
      new NextRequest(`${origin}/api/webhooks/payments/${provider}`, {
        method: "POST",
        headers,
        body,
      }),
      { params: Promise.resolve({ provider }) },
    );
  }

  function mockPayRequest(
    paymentId: string,
    headers: Record<string, string> = {},
  ) {
    return mockPayPost(
      new NextRequest(`${origin}/api/dev/mock-pay/${paymentId}`, {
        method: "POST",
        headers: { host: "localhost:3000", origin, ...headers },
      }),
      { params: Promise.resolve({ paymentId }) },
    );
  }

  it("POST /api/webhooks/payments/mock answers 200 for a paid event and its duplicate", async () => {
    const { order, payment } = await placeOrder(freshDay());
    const event = await paidEvent(payment!.id);
    const first = await webhookRequest("mock", event.body, event.headers);
    expect(first.status).toBe(200);
    const again = await webhookRequest("mock", event.body, event.headers);
    expect(again.status).toBe(200);
    expect((await orderRow(order.id)).queueNumber).toBe(1);
  });

  it("POST /api/webhooks/payments/mock answers 401 for a bad signature", async () => {
    const { payment } = await placeOrder(freshDay());
    const event = await paidEvent(payment!.id);
    const response = await webhookRequest(
      "mock",
      event.body.replace("paid", "expired"),
      event.headers,
    );
    expect(response.status).toBe(401);
  });

  it("POST /api/webhooks/payments/{other} answers 404", async () => {
    const { payment } = await placeOrder(freshDay());
    const event = await paidEvent(payment!.id);
    const response = await webhookRequest("other", event.body, event.headers);
    expect(response.status).toBe(404);
  });

  it("POST /api/dev/mock-pay/{paymentId} pays through the webhook path", async () => {
    const { order, payment } = await placeOrder(freshDay());
    const response = await mockPayRequest(payment!.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { outcome: "paid" } });
    expect((await orderRow(order.id)).status).toBe("paid");
  });

  it("POST /api/dev/mock-pay refuses cross-site requests, bad ids and unknown payments", async () => {
    const { payment } = await placeOrder(freshDay());
    expect(
      (await mockPayRequest(payment!.id, { origin: "http://evil.example" }))
        .status,
    ).toBe(403);
    expect((await mockPayRequest("not-a-uuid")).status).toBe(400);
    expect(
      (await mockPayRequest("8d5b7c1e-0000-4000-8000-00000000dead")).status,
    ).toBe(404);
  });
});
