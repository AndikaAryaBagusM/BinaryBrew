import { eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as ordersPost } from "@/app/api/public/orders/route";
import { closeSql, getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { newQrToken, randomToken } from "@/lib/ids";
import { businessDate } from "@/lib/time";
import {
  createSelfOrder,
  MAX_OPEN_ORDERS,
  resetOrderRateLimits,
} from "@/modules/orders/service";
import { createCatalog } from "./menu-fixtures";

// P1-06 (FR-CO-06, FR-CO-08, BR-03, BR-11, Schema §5.1): the server prices
// every order from the database, refuses sold-out items by name, caps open
// orders per client, and replays a retried request instead of duplicating it.

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

const t0 = new Date("2026-11-01T12:00:00Z"); // 19.00 in Jakarta
const minutes = (n: number) => new Date(t0.getTime() + n * 60_000);
const newSession = () => randomToken(16);
const newKey = () => randomToken(16);

function input(overrides: Partial<Parameters<typeof createSelfOrder>[0]> = {}) {
  return {
    qrToken: catalog.qr.token,
    clientSession: newSession(),
    idempotencyKey: newKey(),
    items: [
      {
        menuItemId: catalog.items.latte.id,
        quantity: 2,
        modifierOptionIds: [
          catalog.options.find((o) => o.name === "Large")!.id,
          catalog.options.find((o) => o.name === "Extra shot")!.id,
        ],
      },
      {
        menuItemId: catalog.items.croissant.id,
        quantity: 1,
        modifierOptionIds: [],
      },
    ],
    ...overrides,
  };
}

const ordersOf = (clientSession: string) =>
  getDb()
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.clientSession, clientSession));

describe("createSelfOrder: pricing and snapshots (Schema §5.1)", () => {
  it("prices from the database and stores the order awaiting payment", async () => {
    const request = input();
    const { order, replayed } = await createSelfOrder(request, { now: t0 });
    expect(replayed).toBe(false);
    // Latte 25.000 + Large 5.000 + Extra shot 5.000 = 35.000 × 2, Croissant 18.000
    expect(order).toMatchObject({
      status: "awaiting_payment",
      subtotal: 88_000,
      serviceCharge: 0,
      taxAmount: 0,
      total: 88_000,
      expiresAt: minutes(10),
    });
    expect(order.publicToken).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const [row] = await ordersOf(request.clientSession);
    expect(row).toMatchObject({
      channel: "self_order",
      status: "awaiting_payment",
      qrTokenId: catalog.qr.id,
      clientSession: request.clientSession,
      idempotencyKey: request.idempotencyKey,
      businessDate: businessDate(t0),
      queueNumber: null,
      paidAt: null,
      subtotal: 88_000,
      total: 88_000,
      taxInclusive: true,
    });
  });

  it("snapshots names, prices and options so later menu edits do not change it", async () => {
    const { order } = await createSelfOrder(input(), { now: t0 });
    const lines = await getDb()
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id));
    const latte = lines.find((l) => l.menuItemId === catalog.items.latte.id)!;
    expect(latte).toMatchObject({
      nameSnapshot: catalog.items.latte.name,
      unitPrice: 25_000,
      modifiersTotal: 10_000,
      quantity: 2,
      lineTotal: 70_000,
      unitCogs: null,
    });
    const modifiers = await getDb()
      .select()
      .from(schema.orderItemModifiers)
      .where(eq(schema.orderItemModifiers.orderItemId, latte.id));
    expect(
      modifiers.map((m) => [
        m.groupNameSnapshot,
        m.optionNameSnapshot,
        m.priceDeltaSnapshot,
      ]),
    ).toEqual([
      [catalog.groups.size.name, "Large", 5_000],
      [catalog.groups.extras.name, "Extra shot", 5_000],
    ]);
  });

  it("uses the current tax, service charge and expiry settings", async () => {
    await getDb()
      .insert(schema.settings)
      .values([
        { key: "tax_rate_bps", value: 1100 },
        { key: "service_charge_bps", value: 500 },
        { key: "order_expiry_minutes", value: 15 },
      ]);
    const { order } = await createSelfOrder(input(), { now: t0 });
    // 88.000 + 5 % = 92.400; tax included: 92.400 × 1100 / 11100 = 9.156,76
    expect(order).toMatchObject({
      subtotal: 88_000,
      serviceCharge: 4_400,
      taxAmount: 9_157,
      total: 92_400,
      expiresAt: minutes(15),
    });
  });

  it("never takes prices from the client: a price in the body is refused", async () => {
    const session = newSession();
    const response = await post(
      {
        qrToken: catalog.qr.token,
        clientSession: session,
        items: [
          {
            menuItemId: catalog.items.croissant.id,
            quantity: 1,
            modifierOptionIds: [],
            price: 1,
          },
        ],
        total: 1,
      },
      newKey(),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_FAILED");
    expect(await ordersOf(session)).toEqual([]);
  });
});

describe("createSelfOrder: refusals", () => {
  it("names the sold-out items and creates nothing (FR-CO-06)", async () => {
    const request = input({
      items: [
        {
          menuItemId: catalog.items.americano.id,
          quantity: 1,
          modifierOptionIds: [],
        },
        {
          menuItemId: catalog.items.soldOut.id,
          quantity: 1,
          modifierOptionIds: [],
        },
        {
          menuItemId: catalog.items.inactive.id,
          quantity: 1,
          modifierOptionIds: [],
        },
      ],
    });
    await expect(createSelfOrder(request, { now: t0 })).rejects.toMatchObject({
      code: "ITEM_SOLD_OUT",
      details: {
        items: [
          {
            menuItemId: catalog.items.soldOut.id,
            name: catalog.items.soldOut.name,
          },
          {
            menuItemId: catalog.items.inactive.id,
            name: catalog.items.inactive.name,
          },
        ],
      },
    });
    expect(await ordersOf(request.clientSession)).toEqual([]);
  });

  it("refuses invalid option choices with the pricing reason", async () => {
    const request = input({
      items: [
        {
          menuItemId: catalog.items.latte.id,
          quantity: 1,
          modifierOptionIds: [],
        },
      ],
    });
    await expect(createSelfOrder(request, { now: t0 })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { reason: "too_few_options", groupId: catalog.groups.size.id },
    });
  });

  it("refuses an item id that does not exist", async () => {
    const request = input({
      items: [
        {
          menuItemId: "00000000-0000-4000-8000-000000000000",
          quantity: 1,
          modifierOptionIds: [],
        },
      ],
    });
    await expect(createSelfOrder(request, { now: t0 })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { reason: "unknown_item" },
    });
  });

  it("refuses a rotated QR code and closed ordering (FR-CO-07)", async () => {
    await expect(
      createSelfOrder(input({ qrToken: catalog.rotatedQr.token }), { now: t0 }),
    ).rejects.toMatchObject({ code: "QR_INVALID" });

    await getDb()
      .insert(schema.settings)
      .values({ key: "ordering_enabled", value: false });
    const request = input();
    await expect(createSelfOrder(request, { now: t0 })).rejects.toMatchObject({
      code: "ORDERING_CLOSED",
    });
    expect(await ordersOf(request.clientSession)).toEqual([]);
  });
});

describe("open-order cap (FR-CO-08, BR-11)", () => {
  it(`refuses the ${MAX_OPEN_ORDERS + 1}th unpaid order of one client`, async () => {
    const clientSession = newSession();
    for (let i = 0; i < MAX_OPEN_ORDERS; i++) {
      await createSelfOrder(input({ clientSession }), { now: minutes(i) });
    }
    await expect(
      createSelfOrder(input({ clientSession }), { now: minutes(3) }),
    ).rejects.toMatchObject({ code: "OPEN_ORDER_LIMIT" });

    // Another browser is not affected.
    await expect(
      createSelfOrder(input(), { now: minutes(3) }),
    ).resolves.toBeDefined();
  });

  it("does not count orders whose payment time has passed", async () => {
    const clientSession = newSession();
    for (let i = 0; i < MAX_OPEN_ORDERS; i++) {
      await createSelfOrder(input({ clientSession }), { now: t0 });
    }
    // Expiry is 10 minutes; the sweep (P1-09) may not have run yet.
    await expect(
      createSelfOrder(input({ clientSession }), { now: minutes(10) }),
    ).resolves.toBeDefined();
  });

  it("holds under concurrent requests from one client", async () => {
    const clientSession = newSession();
    const results = await Promise.allSettled(
      Array.from({ length: MAX_OPEN_ORDERS + 3 }, () =>
        createSelfOrder(input({ clientSession }), { now: t0 }),
      ),
    );
    const created = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected");
    expect(created).toHaveLength(MAX_OPEN_ORDERS);
    for (const r of refused) {
      expect((r as PromiseRejectedResult).reason).toMatchObject({
        code: "OPEN_ORDER_LIMIT",
      });
    }
    expect(await ordersOf(clientSession)).toHaveLength(MAX_OPEN_ORDERS);
  });
});

describe("idempotency key", () => {
  it("returns the same order for the same key and creates it once", async () => {
    const request = input();
    const first = await createSelfOrder(request, { now: t0 });
    const again = await createSelfOrder(request, { now: minutes(1) });
    expect(again.replayed).toBe(true);
    expect(again.order).toEqual(first.order);
    expect(await ordersOf(request.clientSession)).toHaveLength(1);
  });

  it("returns one order for parallel retries with the same key", async () => {
    const request = input();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => createSelfOrder(request, { now: t0 })),
    );
    expect(new Set(results.map((r) => r.order.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await ordersOf(request.clientSession)).toHaveLength(1);
  });

  it("replays even when the client has reached the cap with that very order", async () => {
    const clientSession = newSession();
    const requests = Array.from({ length: MAX_OPEN_ORDERS }, () =>
      input({ clientSession }),
    );
    for (const request of requests) await createSelfOrder(request, { now: t0 });
    const retry = await createSelfOrder(requests.at(-1)!, { now: t0 });
    expect(retry.replayed).toBe(true);
  });

  it("is scoped to the client: another browser with the same key gets its own order", async () => {
    const key = newKey();
    const a = await createSelfOrder(input({ idempotencyKey: key }), {
      now: t0,
    });
    const b = await createSelfOrder(input({ idempotencyKey: key }), {
      now: t0,
    });
    expect(a.order.id).not.toBe(b.order.id);
  });
});

// Route: POST /api/public/orders (Tech §6)
function post(body: unknown, idempotencyKey?: string, ip = "10.0.0.7") {
  const headers = new Headers({
    host: "localhost:3000",
    "content-type": "application/json",
    origin: "http://localhost:3000",
    "x-forwarded-for": ip,
  });
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  return ordersPost(
    new NextRequest("http://localhost:3000/api/public/orders", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/public/orders", () => {
  const body = () => {
    const { qrToken, clientSession, items } = input();
    return { qrToken, clientSession, items };
  };

  it("answers 201 with the public token, total and expiry, never the internal id", async () => {
    const response = await post(body(), newKey());
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { data } = await response.json();
    expect(Object.keys(data).sort()).toEqual(
      ["expiresAt", "publicToken", "status", "total"].sort(),
    );
    expect(data).toMatchObject({ status: "awaiting_payment", total: 88_000 });
    expect(Date.parse(data.expiresAt)).not.toBeNaN();
  });

  it("answers 200 with the same order when the same request is retried", async () => {
    const request = body();
    const key = newKey();
    const first = await (await post(request, key)).json();
    const retry = await post(request, key);
    expect(retry.status).toBe(200);
    expect((await retry.json()).data).toEqual(first.data);
  });

  it("requires an Idempotency-Key header", async () => {
    const response = await post(body());
    expect(response.status).toBe(400);
    expect((await response.json()).error.details).toEqual({
      fields: ["idempotency-key"],
    });
  });

  it("maps refusals to status codes with Indonesian messages", async () => {
    const soldOut = await post(
      {
        ...body(),
        items: [
          {
            menuItemId: catalog.items.soldOut.id,
            quantity: 1,
            modifierOptionIds: [],
          },
        ],
      },
      newKey(),
    );
    expect(soldOut.status).toBe(409);
    expect((await soldOut.json()).error).toMatchObject({
      code: "ITEM_SOLD_OUT",
      message: "Maaf, ada menu yang habis",
      details: { items: [{ name: catalog.items.soldOut.name }] },
    });

    const clientSession = newSession();
    for (let i = 0; i < MAX_OPEN_ORDERS; i++) {
      await post({ ...body(), clientSession }, newKey());
    }
    const capped = await post({ ...body(), clientSession }, newKey());
    expect(capped.status).toBe(409);
    expect((await capped.json()).error.code).toBe("OPEN_ORDER_LIMIT");
  });

  it("rate-limits one IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await post(body(), newKey(), "10.9.9.9")).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it("refuses a cross-site request", async () => {
    const response = await ordersPost(
      new NextRequest("http://localhost:3000/api/public/orders", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          "content-type": "application/json",
          origin: "https://evil.example",
          "idempotency-key": newKey(),
        },
        body: JSON.stringify(body()),
      }),
    );
    expect(response.status).toBe(403);
  });
});

it("refuses a QR token that was never issued", async () => {
  await expect(
    createSelfOrder(input({ qrToken: newQrToken() }), { now: t0 }),
  ).rejects.toMatchObject({
    code: "QR_INVALID",
  });
});
