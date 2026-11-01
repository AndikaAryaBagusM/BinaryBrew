import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as cancelPost } from "@/app/api/public/orders/[publicToken]/cancel/route";
import { GET as orderGet } from "@/app/api/public/orders/[publicToken]/route";
import { GET as streamGet } from "@/app/api/stream/orders/[publicToken]/route";
import { closeSql, getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { randomToken } from "@/lib/ids";
import { subscribeToOrderEvents } from "@/modules/orders/events";
import {
  cancelSelfOrder,
  createSelfOrder,
  getPublicOrder,
  resetOrderRateLimits,
} from "@/modules/orders/service";
import { mockPay } from "@/modules/payments/service";
import { createCatalog } from "./menu-fixtures";

// P1-08 (FR-PM-02, FR-QF-03, Tech §7): what the payment and status screens
// read, the customer's "Kembali ke keranjang" cancel, and the live order
// events behind the SSE stream.

afterAll(() => closeSql());

let catalog: Awaited<ReturnType<typeof createCatalog>>;
beforeAll(async () => {
  catalog = await createCatalog();
});
beforeEach(() => resetOrderRateLimits());

// Own business days (queue counters persist across files): see payments.test.ts.
let dayOffset = 0;
const freshDay = () =>
  new Date(Date.UTC(2200, 0, 1, 5) + dayOffset++ * 86_400_000);
const later = (at: Date, minutes: number) =>
  new Date(at.getTime() + minutes * 60_000);

const large = () => catalog.options.find((o) => o.name === "Large")!.id;
const extraShot = () =>
  catalog.options.find((o) => o.name === "Extra shot")!.id;

async function placeOrder(now = freshDay(), qrToken = catalog.qr.token) {
  return createSelfOrder(
    {
      qrToken,
      clientSession: randomToken(16),
      idempotencyKey: randomToken(16),
      items: [
        {
          menuItemId: catalog.items.latte.id,
          quantity: 2,
          modifierOptionIds: [large(), extraShot()],
        },
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

describe("getPublicOrder (C-05, C-06, C-07)", () => {
  it("returns what the payment screen needs while unpaid", async () => {
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    const view = await getPublicOrder(order.publicToken);
    expect(view).toEqual({
      publicToken: order.publicToken,
      status: "awaiting_payment",
      queueNumber: null,
      createdAt: expect.any(Date),
      paidAt: null,
      expiresAt: order.expiresAt,
      subtotal: 88_000,
      serviceCharge: 0,
      taxAmount: 0,
      taxInclusive: true,
      total: 88_000,
      items: [
        {
          name: catalog.items.latte.name,
          quantity: 2,
          lineTotal: 70_000,
          options: ["Large", "Extra shot"],
        },
        {
          name: catalog.items.croissant.name,
          quantity: 1,
          lineTotal: 18_000,
          options: [],
        },
      ],
      payment: {
        id: payment!.id,
        method: "qris_dynamic",
        amount: 88_000,
        qrString: payment!.qrString,
        expiresAt: order.expiresAt,
      },
      menuPath: `/o/${catalog.qr.token}`,
    });
  });

  it("shows the queue number once paid, and no longer the QR", async () => {
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    await mockPay(payment!.id, { now: later(now, 1) });
    const view = await getPublicOrder(order.publicToken);
    expect(view).toMatchObject({
      status: "paid",
      queueNumber: 1,
      paidAt: later(now, 1),
      payment: { id: payment!.id, qrString: null, amount: 88_000 },
    });
  });

  it("has no menu link once the table's QR code is rotated", async () => {
    const [qr] = await getDb()
      .insert(schema.qrTokens)
      .values({ label: "Meja " + randomToken(16), token: randomToken(16) })
      .returning();
    const { order } = await placeOrder(freshDay(), qr!.token);
    await getDb()
      .update(schema.qrTokens)
      .set({ isActive: false })
      .where(eq(schema.qrTokens.id, qr!.id));
    expect((await getPublicOrder(order.publicToken)).menuPath).toBeNull();
  });

  it.each([
    ["an unknown token", randomToken(16)],
    ["a malformed token", "not a token"],
  ])("refuses %s with NOT_FOUND", async (_case, token) => {
    await expect(getPublicOrder(token)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe('cancelSelfOrder (C-05 "Kembali ke keranjang")', () => {
  it("expires an unpaid order and its charge, and emits the change", async () => {
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    const events: unknown[] = [];
    const unsubscribe = await subscribeToOrderEvents((e) => events.push(e));
    try {
      const result = await cancelSelfOrder(order.publicToken, {
        now: later(now, 2),
      });
      expect(result).toEqual({ status: "expired" });
      await expect.poll(() => events.length).toBeGreaterThan(0);
    } finally {
      await unsubscribe();
    }
    expect(events).toContainEqual({
      orderId: order.id,
      status: "expired",
      queueNumber: null,
    });
    expect((await orderRow(order.id)).status).toBe("expired");
    expect((await paymentRow(payment!.id)).status).toBe("expired");
  });

  it("frees a place under the open-order cap", async () => {
    const now = freshDay();
    const clientSession = randomToken(16);
    const request = () => ({
      qrToken: catalog.qr.token,
      clientSession,
      idempotencyKey: randomToken(16),
      items: [
        {
          menuItemId: catalog.items.croissant.id,
          quantity: 1,
          modifierOptionIds: [],
        },
      ],
    });
    const first = await createSelfOrder(request(), { now });
    await createSelfOrder(request(), { now });
    await createSelfOrder(request(), { now });
    await expect(createSelfOrder(request(), { now })).rejects.toMatchObject({
      code: "OPEN_ORDER_LIMIT",
    });
    await cancelSelfOrder(first.order.publicToken, { now });
    await expect(createSelfOrder(request(), { now })).resolves.toBeDefined();
  });

  it("never cancels a paid order (BR-06) and is safe to repeat", async () => {
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    await mockPay(payment!.id, { now: later(now, 1) });
    expect(await cancelSelfOrder(order.publicToken, { now })).toEqual({
      status: "paid",
    });
    expect(await orderRow(order.id)).toMatchObject({
      status: "paid",
      queueNumber: 1,
    });

    const unpaid = await placeOrder(now);
    await cancelSelfOrder(unpaid.order.publicToken, { now });
    expect(await cancelSelfOrder(unpaid.order.publicToken, { now })).toEqual({
      status: "expired",
    });
  });

  it("a payment that still arrives follows the late-payment rule", async () => {
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    await cancelSelfOrder(order.publicToken, { now });
    const result = await mockPay(payment!.id, { now: later(now, 1) });
    expect(result.outcome).toBe("revived");
    expect((await orderRow(order.id)).status).toBe("paid");
  });

  it("refuses an unknown token", async () => {
    await expect(cancelSelfOrder(randomToken(16))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("subscribeToOrderEvents (Tech §7)", () => {
  it("fans one LISTEN out to every subscriber, until each unsubscribes", async () => {
    const now = freshDay();
    const a: { orderId: string }[] = [];
    const b: { orderId: string }[] = [];
    const stopA = await subscribeToOrderEvents((e) => a.push(e));
    const stopB = await subscribeToOrderEvents((e) => b.push(e));

    const first = await placeOrder(now);
    await mockPay(first.payment!.id, { now: later(now, 1) });
    await expect
      .poll(() => b.some((e) => e.orderId === first.order.id))
      .toBe(true);
    expect(a.some((e) => e.orderId === first.order.id)).toBe(true);

    await stopA();
    const second = await placeOrder(now);
    await mockPay(second.payment!.id, { now: later(now, 1) });
    await expect
      .poll(() => b.some((e) => e.orderId === second.order.id))
      .toBe(true);
    expect(a.some((e) => e.orderId === second.order.id)).toBe(false);
    await stopB();
  });
});

describe("routes", () => {
  const origin = "http://localhost:3000";
  const context = (publicToken: string) => ({
    params: Promise.resolve({ publicToken }),
  });

  it("GET /api/public/orders/{publicToken} answers no-store JSON, 404 when unknown", async () => {
    const { order, payment } = await placeOrder();
    const response = await orderGet(
      new NextRequest(`${origin}/api/public/orders/${order.publicToken}`),
      context(order.publicToken),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { data } = await response.json();
    expect(data).toMatchObject({
      status: "awaiting_payment",
      total: 88_000,
      expiresAt: order.expiresAt.toISOString(),
      payment: { id: payment!.id, qrString: payment!.qrString },
    });

    const unknown = randomToken(16);
    const missing = await orderGet(
      new NextRequest(`${origin}/api/public/orders/${unknown}`),
      context(unknown),
    );
    expect(missing.status).toBe(404);
  });

  it("POST /api/public/orders/{publicToken}/cancel is same-origin only", async () => {
    const { order } = await placeOrder();
    const post = (headers: Record<string, string>) =>
      cancelPost(
        new NextRequest(
          `${origin}/api/public/orders/${order.publicToken}/cancel`,
          { method: "POST", headers: { host: "localhost:3000", ...headers } },
        ),
        context(order.publicToken),
      );
    expect((await post({ origin: "http://evil.example" })).status).toBe(403);
    expect((await orderRow(order.id)).status).toBe("awaiting_payment");

    const response = await post({ origin });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { status: "expired" } });
  });

  it("GET /api/stream/orders/{publicToken} sends the current state, then changes", async () => {
    const now = freshDay();
    const { order, payment } = await placeOrder(now);
    const abort = new AbortController();
    const response = await streamGet(
      new NextRequest(`${origin}/api/stream/orders/${order.publicToken}`, {
        signal: abort.signal,
      }),
      context(order.publicToken),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-cache");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    const readUntil = async (text: string) => {
      while (!received.includes(text)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stream ended before "${text}"`);
        received += decoder.decode(value);
      }
    };

    await readUntil(`"status":"awaiting_payment"`);
    expect(received).toMatch(/^retry: \d+\n/);
    expect(received).toContain("event: order\n");

    // Another order's change is not sent to this stream.
    const other = await placeOrder(now);
    await mockPay(other.payment!.id, { now: later(now, 1) });
    await mockPay(payment!.id, { now: later(now, 1) });
    await readUntil(`"status":"paid"`);
    expect(received).toContain(`data: {"status":"paid","queueNumber":2}\n\n`);
    expect(received).not.toContain(`"queueNumber":1`);

    abort.abort();
    await reader.cancel().catch(() => {});
  });

  it("GET /api/stream/orders/{publicToken} answers 404 for an unknown order", async () => {
    const unknown = randomToken(16);
    const response = await streamGet(
      new NextRequest(`${origin}/api/stream/orders/${unknown}`),
      context(unknown),
    );
    expect(response.status).toBe(404);
  });
});
