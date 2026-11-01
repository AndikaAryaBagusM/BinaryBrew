import { and, eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { POST as elevatePost } from "@/app/api/auth/elevate/route";
import { GET as counterMenuGet } from "@/app/api/counter/menu/route";
import { POST as soldOutPost } from "@/app/api/counter/menu-items/[id]/sold-out/route";
import { POST as counterOrdersPost } from "@/app/api/counter/orders/route";
import { GET as counterOrderGet } from "@/app/api/counter/orders/[id]/route";
import { POST as cancelPost } from "@/app/api/counter/orders/[id]/cancel/route";
import { POST as manualPaymentPost } from "@/app/api/counter/orders/[id]/manual-payment/route";
import { closeSql, getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { randomToken } from "@/lib/ids";
import { SESSION_COOKIE } from "@/modules/auth/cookies";
import {
  elevate,
  pinLogin,
  resetAuthRateLimits,
  type SessionUser,
} from "@/modules/auth/service";
import {
  getCounterMenu,
  getPublicMenu,
  setManualSoldOut,
} from "@/modules/menu/service";
import {
  cancelCounterOrder,
  createCounterOrder,
  createSelfOrder,
  getCounterOrder,
  listCounterQueue,
  resetOrderRateLimits,
} from "@/modules/orders/service";
import { confirmManualPayment, mockPay } from "@/modules/payments/service";
import type { CartLine } from "@/modules/orders/pricing";
import { createDevice, createUser, unique } from "./auth-fixtures";
import { createCatalog } from "./menu-fixtures";

// P1-11 (FR-POS-01, 02, 04, 05, FR-PM-05, Flow §5.3, §5.4, §8): walk-in
// orders at the Counter use the same pricing and availability as self-order
// and are paid with the tablet's QRIS or confirmed by hand with the owner's
// PIN; staff mark items sold out and the customer menu follows.
//
// Integration files share one database: assertions look at this file's
// orders and items only.

afterAll(() => closeSql());

const SETTINGS = [
  "ordering_enabled",
  "manual_payment_requires_owner_pin",
] as const;
const clearSettings = () =>
  getDb()
    .delete(schema.settings)
    .where(inArray(schema.settings.key, [...SETTINGS]));
const setSetting = (key: (typeof SETTINGS)[number], value: boolean) =>
  getDb()
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } });

let catalog: Awaited<ReturnType<typeof createCatalog>>;
let owner: Awaited<ReturnType<typeof createUser>>;
beforeAll(async () => {
  catalog = await createCatalog();
  owner = await createUser({ role: "owner", pin: "864209" });
  await clearSettings();
});
beforeEach(() => {
  resetOrderRateLimits();
  resetAuthRateLimits();
});
afterEach(() => clearSettings());

// Own business days (queue counters persist across files).
let dayOffset = 0;
const freshDay = () =>
  new Date(Date.UTC(2320, 0, 1, 5) + dayOffset++ * 86_400_000);
const later = (at: Date, ms: number) => new Date(at.getTime() + ms);
const MINUTE = 60_000;

async function staffLogin(role: "staff" | "barista" | "owner" = "staff") {
  const user = await createUser({ role, pin: "135790" });
  const device = await createDevice();
  const login = await pinLogin({
    userId: user.id,
    pin: user.pin,
    deviceToken: device.token,
    ip: unique("ip"),
  });
  return { user: login.user, token: login.token, name: user.name };
}

const croissantLine = (quantity = 1): CartLine => ({
  menuItemId: catalog.items.croissant.id,
  quantity,
  modifierOptionIds: [],
});

function counterInput(items: CartLine[] = [croissantLine()]) {
  return {
    clientSession: randomToken(16),
    idempotencyKey: randomToken(16),
    items,
  };
}

const orderRow = async (id: string) =>
  (
    await getDb().select().from(schema.orders).where(eq(schema.orders.id, id))
  )[0]!;
const paymentsOf = (orderId: string) =>
  getDb()
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.orderId, orderId));
const auditsOf = (action: string, entityId: string) =>
  getDb()
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.action, action),
        eq(schema.auditLogs.entityId, entityId),
      ),
    );

const ownerElevation = (actor: SessionUser, now: Date) =>
  elevate(actor, { pin: owner.pin, scope: "manual_payment" }, { now });

describe("getCounterMenu (FR-POS-01)", () => {
  it("needs a signed-in Counter user", async () => {
    await expect(getCounterMenu(null)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("lists active items with options, sold-out ones unavailable, plus the rates", async () => {
    const { user } = await staffLogin();
    const menu = await getCounterMenu(user);
    const drinks = menu.categories.find(
      (c) => c.id === catalog.categories.drinks.id,
    )!;
    expect(drinks.items.map((i) => i.name)).toEqual([
      catalog.items.americano.name,
      catalog.items.latte.name,
      catalog.items.soldOut.name,
    ]);
    const latte = drinks.items.find((i) => i.id === catalog.items.latte.id)!;
    expect(latte.modifierGroups.map((g) => g.id)).toEqual([
      catalog.groups.size.id,
      catalog.groups.extras.id,
    ]);
    const soldOut = drinks.items.find(
      (i) => i.id === catalog.items.soldOut.id,
    )!;
    expect(soldOut).toMatchObject({ isAvailable: false });
    expect(menu.categories.map((c) => c.id)).not.toContain(
      catalog.categories.hidden.id,
    );
    expect(menu.pricing).toEqual({
      taxRateBps: 0,
      taxInclusive: true,
      serviceChargeBps: 0,
    });
    expect(menu.manualPaymentNeedsOwnerPin).toBe(true);
  });

  it("works while self-ordering is closed (E9) and reports the owner PIN setting", async () => {
    const { user } = await staffLogin();
    await setSetting("ordering_enabled", false);
    await setSetting("manual_payment_requires_owner_pin", false);
    const menu = await getCounterMenu(user);
    expect(menu.categories.length).toBeGreaterThan(0);
    expect(menu.manualPaymentNeedsOwnerPin).toBe(false);
  });
});

describe("createCounterOrder (FR-POS-01, FR-POS-02)", () => {
  it("creates a counter order by this user with a pending QRIS charge, priced by the server", async () => {
    const { user } = await staffLogin();
    const now = freshDay();
    const input = counterInput([
      croissantLine(2),
      {
        menuItemId: catalog.items.latte.id,
        quantity: 1,
        modifierOptionIds: [
          catalog.options.find((o) => o.name === "Large")!.id,
        ],
      },
    ]);
    const { order, payment, replayed } = await createCounterOrder(user, input, {
      now,
    });
    expect(replayed).toBe(false);
    expect(order).toMatchObject({
      status: "awaiting_payment",
      total: 2 * 18000 + 25000 + 5000,
    });
    expect(payment).toMatchObject({ amount: order.total });
    expect(payment!.qrString).toBeTruthy();

    const row = await orderRow(order.id);
    expect(row).toMatchObject({
      channel: "counter",
      createdBy: user.userId,
      qrTokenId: null,
      clientSession: input.clientSession,
    });
  });

  it("works while self-ordering is closed (E9) and has no open-order cap", async () => {
    const { user } = await staffLogin();
    await setSetting("ordering_enabled", false);
    const now = freshDay();
    const clientSession = randomToken(16);
    for (let i = 0; i < 4; i++) {
      await createCounterOrder(
        user,
        { ...counterInput(), clientSession },
        { now },
      );
    }
  });

  it("returns the same order for the same idempotency key", async () => {
    const { user } = await staffLogin();
    const now = freshDay();
    const input = counterInput();
    const first = await createCounterOrder(user, input, { now });
    const again = await createCounterOrder(user, input, { now });
    expect(again.replayed).toBe(true);
    expect(again.order.id).toBe(first.order.id);
    expect(again.payment!.id).toBe(first.payment!.id);
  });

  it("refuses a sold-out item, naming it", async () => {
    const { user } = await staffLogin();
    await expect(
      createCounterOrder(
        user,
        counterInput([
          {
            menuItemId: catalog.items.soldOut.id,
            quantity: 1,
            modifierOptionIds: [],
          },
        ]),
        { now: freshDay() },
      ),
    ).rejects.toMatchObject({
      code: "ITEM_SOLD_OUT",
      details: {
        items: [
          {
            menuItemId: catalog.items.soldOut.id,
            name: catalog.items.soldOut.name,
          },
        ],
      },
    });
  });

  it("needs a signed-in Counter user", async () => {
    await expect(
      createCounterOrder(null, counterInput(), { now: freshDay() }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("joins the queue when paid", async () => {
    const { user } = await staffLogin();
    const now = freshDay();
    const { order, payment } = await createCounterOrder(user, counterInput(), {
      now,
    });
    await mockPay(payment!.id, { now: later(now, MINUTE) });
    const queued = (await listCounterQueue(user)).find(
      (o) => o.id === order.id,
    );
    expect(queued).toMatchObject({
      status: "paid",
      channel: "counter",
      queueNumber: 1,
    });
  });
});

describe("getCounterOrder (S-04, S-06, FR-POS-05)", () => {
  it("returns the order with lines, totals, payment and times", async () => {
    const { user, name } = await staffLogin();
    const now = freshDay();
    const { order, payment } = await createCounterOrder(
      user,
      counterInput([croissantLine(2)]),
      { now },
    );

    const waiting = await getCounterOrder(user, order.id);
    expect(waiting).toMatchObject({
      id: order.id,
      publicToken: order.publicToken,
      status: "awaiting_payment",
      channel: "counter",
      table: null,
      createdByName: name,
      queueNumber: null,
      total: 36000,
      items: [
        {
          name: catalog.items.croissant.name,
          quantity: 2,
          lineTotal: 36000,
          options: [],
        },
      ],
      payment: {
        id: payment!.id,
        method: "qris_dynamic",
        status: "pending",
        amount: 36000,
        qrString: payment!.qrString,
        paidAt: null,
      },
    });

    await mockPay(payment!.id, { now: later(now, MINUTE) });
    const paid = await getCounterOrder(user, order.id);
    expect(paid).toMatchObject({
      status: "paid",
      queueNumber: 1,
      paidAt: later(now, MINUTE),
      payment: { status: "paid", qrString: null, paidAt: later(now, MINUTE) },
    });
    expect(paid.payment!.reference).toMatch(/^mock_/); // the gateway reference
  });

  it("names the table of a self-order", async () => {
    const { user } = await staffLogin();
    const { order } = await createSelfOrder(
      {
        qrToken: catalog.qr.token,
        clientSession: randomToken(16),
        idempotencyKey: randomToken(16),
        items: [croissantLine()],
      },
      { now: freshDay() },
    );
    expect(await getCounterOrder(user, order.id)).toMatchObject({
      channel: "self_order",
      table: catalog.qr.label,
      createdByName: null,
    });
  });

  it("is 404 for an unknown or malformed id", async () => {
    const { user } = await staffLogin();
    await expect(
      getCounterOrder(user, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getCounterOrder(user, "nope")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("cancelCounterOrder (S-04 Batalkan)", () => {
  it("expires an unpaid counter order and its charge", async () => {
    const { user } = await staffLogin();
    const now = freshDay();
    const { order } = await createCounterOrder(user, counterInput(), { now });
    expect(
      await cancelCounterOrder(user, order.id, { now: later(now, MINUTE) }),
    ).toEqual({ status: "expired" });
    expect((await orderRow(order.id)).status).toBe("expired");
    expect((await paymentsOf(order.id)).map((p) => p.status)).toEqual([
      "expired",
    ]);
  });

  it("leaves a paid order alone and returns its status", async () => {
    const { user } = await staffLogin();
    const now = freshDay();
    const { order, payment } = await createCounterOrder(user, counterInput(), {
      now,
    });
    await mockPay(payment!.id, { now });
    expect(await cancelCounterOrder(user, order.id, { now })).toEqual({
      status: "paid",
    });
    expect((await orderRow(order.id)).status).toBe("paid");
  });
});

describe("confirmManualPayment (FR-PM-05, Flow §5.4)", () => {
  async function unpaidOrder() {
    const { user, token } = await staffLogin();
    const now = freshDay();
    const { order, payment } = await createCounterOrder(user, counterInput(), {
      now,
    });
    return { user, token, now, order, payment: payment! };
  }

  it("needs the owner's PIN by default; nothing changes without it", async () => {
    const { user, now, order } = await unpaidOrder();
    await expect(
      confirmManualPayment(
        user,
        { orderId: order.id, reference: "4821" },
        { now },
      ),
    ).rejects.toMatchObject({ code: "ELEVATION_REQUIRED" });
    expect((await orderRow(order.id)).status).toBe("awaiting_payment");
    expect((await paymentsOf(order.id)).map((p) => p.status)).toEqual([
      "pending",
    ]);
  });

  it("with an elevation: pays the order, records who and why, and spends the elevation", async () => {
    const { user, now, order, payment } = await unpaidOrder();
    const at = later(now, MINUTE);
    const { elevationId } = await ownerElevation(user, at);

    const result = await confirmManualPayment(
      user,
      {
        orderId: order.id,
        reference: "4821",
        note: "dibayar lewat QR kios",
        elevationId,
      },
      { now: at },
    );
    expect(result).toMatchObject({ status: "paid", queueNumber: 1 });

    expect(await orderRow(order.id)).toMatchObject({
      status: "paid",
      queueNumber: 1,
      paidAt: at,
    });
    const payments = await paymentsOf(order.id);
    expect(payments.find((p) => p.id === payment.id)!.status).toBe("expired");
    const manual = payments.find((p) => p.method === "qris_static_manual")!;
    expect(manual).toMatchObject({
      id: result.paymentId,
      status: "paid",
      amount: order.total,
      paidAt: at,
      confirmedBy: user.userId,
      elevationId,
      manualReference: "4821",
      manualNote: "dibayar lewat QR kios",
    });

    const audits = await auditsOf("payment.manual_confirm", manual.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: user.userId,
      entityType: "payment",
      metadata: {
        orderId: order.id,
        amount: order.total,
        reference: "4821",
        elevationId,
        ownerUserId: owner.id,
      },
    });

    // One use only (Tech §9).
    const { order: other } = await createCounterOrder(user, counterInput(), {
      now,
    });
    await expect(
      confirmManualPayment(
        user,
        { orderId: other.id, reference: "4822", elevationId },
        { now: at },
      ),
    ).rejects.toMatchObject({ code: "ELEVATION_REQUIRED" });
  });

  it("refuses an elevation for another scope", async () => {
    const { user, now, order } = await unpaidOrder();
    const { elevationId } = await elevate(
      user,
      { pin: owner.pin, scope: "void_order" },
      { now },
    );
    await expect(
      confirmManualPayment(
        user,
        { orderId: order.id, reference: "4821", elevationId },
        { now },
      ),
    ).rejects.toMatchObject({ code: "ELEVATION_REQUIRED" });
  });

  it("needs no PIN when the owner turned the setting off", async () => {
    await setSetting("manual_payment_requires_owner_pin", false);
    const { user, now, order } = await unpaidOrder();
    const result = await confirmManualPayment(
      user,
      { orderId: order.id, reference: "77" },
      { now },
    );
    expect(result.status).toBe("paid");
    const manual = (await paymentsOf(order.id)).find(
      (p) => p.method === "qris_static_manual",
    )!;
    expect(manual.elevationId).toBeNull();
    expect(await auditsOf("payment.manual_confirm", manual.id)).toHaveLength(1);
  });

  it("refuses an order that is already paid (E18)", async () => {
    await setSetting("manual_payment_requires_owner_pin", false);
    const { user, now, order, payment } = await unpaidOrder();
    await mockPay(payment.id, { now });
    await expect(
      confirmManualPayment(
        user,
        { orderId: order.id, reference: "4821" },
        { now },
      ),
    ).rejects.toMatchObject({
      code: "ORDER_STATUS_CHANGED",
      details: { status: "paid" },
    });
  });

  it("revives an expired order when its items are still available", async () => {
    await setSetting("manual_payment_requires_owner_pin", false);
    const { user, now, order } = await unpaidOrder();
    await cancelCounterOrder(user, order.id, { now });
    const result = await confirmManualPayment(
      user,
      { orderId: order.id, reference: "4821" },
      { now: later(now, MINUTE) },
    );
    expect(result.status).toBe("paid");
    expect((await orderRow(order.id)).status).toBe("paid");
  });

  it("is 404 for an unknown order", async () => {
    const { user } = await staffLogin();
    await expect(
      confirmManualPayment(user, {
        orderId: "00000000-0000-4000-8000-000000000000",
        reference: "1",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("setManualSoldOut (FR-POS-04)", () => {
  it("marks an item sold out: the customer menu greys it out, checkout refuses it, and S-08 says who", async () => {
    const { user, name } = await staffLogin();
    const item = catalog.items.americano;
    const now = freshDay();
    try {
      expect(
        await setManualSoldOut(
          user,
          { menuItemId: item.id, soldOut: true },
          { now },
        ),
      ).toEqual({ menuItemId: item.id, soldOut: true });

      const publicItem = (await getPublicMenu(catalog.qr.token)).categories
        .flatMap((c) => c.items)
        .find((i) => i.id === item.id)!;
      expect(publicItem.isAvailable).toBe(false);

      await expect(
        createSelfOrder(
          {
            qrToken: catalog.qr.token,
            clientSession: randomToken(16),
            idempotencyKey: randomToken(16),
            items: [
              { menuItemId: item.id, quantity: 1, modifierOptionIds: [] },
            ],
          },
          { now },
        ),
      ).rejects.toMatchObject({ code: "ITEM_SOLD_OUT" });

      const counterItem = (await getCounterMenu(user)).categories
        .flatMap((c) => c.items)
        .find((i) => i.id === item.id)!;
      expect(counterItem).toMatchObject({
        isAvailable: false,
        soldOut: { byName: name, at: now },
      });
      expect(await auditsOf("menu_item.sold_out", item.id)).toHaveLength(1);
    } finally {
      await setManualSoldOut(
        user,
        { menuItemId: item.id, soldOut: false },
        { now: later(now, MINUTE) },
      );
    }
    const back = (await getCounterMenu(user)).categories
      .flatMap((c) => c.items)
      .find((i) => i.id === item.id)!;
    expect(back).toMatchObject({ isAvailable: true, soldOut: null });
    expect(await auditsOf("menu_item.available", item.id)).toHaveLength(1);
  });

  it("writes no audit row when nothing changes", async () => {
    const { user } = await staffLogin();
    const item = catalog.items.croissant;
    await setManualSoldOut(user, { menuItemId: item.id, soldOut: false });
    expect(await auditsOf("menu_item.available", item.id)).toHaveLength(0);
  });

  it("is 404 for an unknown or inactive item", async () => {
    const { user } = await staffLogin();
    for (const menuItemId of [
      "00000000-0000-4000-8000-000000000000",
      "nope",
      catalog.items.inactive.id,
    ]) {
      await expect(
        setManualSoldOut(user, { menuItemId, soldOut: true }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });
});

// Routes ---------------------------------------------------------------------

const BASE = "http://localhost:3000";

function request(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    session?: string;
    origin?: string | null;
    headers?: Record<string, string>;
  } = {},
) {
  const headers = new Headers({
    host: new URL(BASE).host,
    "content-type": "application/json",
    "x-forwarded-for": unique("ip"),
    ...options.headers,
  });
  const origin = options.origin === undefined ? BASE : options.origin;
  if (origin) headers.set("origin", origin);
  if (options.session) {
    headers.set("cookie", `${SESSION_COOKIE}=${options.session}`);
  }
  return new NextRequest(`${BASE}${path}`, {
    method: options.method ?? "POST",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/counter/menu", () => {
  it("returns the menu, no-store; 401 without a session", async () => {
    const { token } = await staffLogin();
    const response = await counterMenuGet(
      request("/api/counter/menu", { method: "GET", session: token }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const { data } = await response.json();
    expect(data.manualPaymentNeedsOwnerPin).toBe(true);
    expect(
      (await counterMenuGet(request("/api/counter/menu", { method: "GET" })))
        .status,
    ).toBe(401);
  });
});

describe("POST /api/counter/orders", () => {
  const body = () => ({
    clientSession: randomToken(16),
    items: [croissantLine()],
  });

  it("creates the order (201) and replays it (200)", async () => {
    const { token } = await staffLogin();
    const sent = body();
    const send = () =>
      counterOrdersPost(
        request("/api/counter/orders", {
          body: sent,
          session: token,
          headers: { "idempotency-key": "counter-key-0001" },
        }),
      );
    const created = await send();
    expect(created.status).toBe(201);
    const { data } = await created.json();
    expect(data).toMatchObject({
      status: "awaiting_payment",
      total: 18000,
      payment: { amount: 18000 },
    });
    expect(typeof data.id).toBe("string");
    expect(typeof data.payment.qrString).toBe("string");

    const replayed = await send();
    expect(replayed.status).toBe(200);
    expect((await replayed.json()).data.id).toBe(data.id);
  });

  it("needs an Idempotency-Key, the same origin and a session", async () => {
    const { token } = await staffLogin();
    const noKey = await counterOrdersPost(
      request("/api/counter/orders", { body: body(), session: token }),
    );
    expect(noKey.status).toBe(400);
    const foreign = await counterOrdersPost(
      request("/api/counter/orders", {
        body: body(),
        session: token,
        origin: "https://evil.example",
        headers: { "idempotency-key": "counter-key-0002" },
      }),
    );
    expect(foreign.status).toBe(403);
    const anonymous = await counterOrdersPost(
      request("/api/counter/orders", {
        body: body(),
        headers: { "idempotency-key": "counter-key-0003" },
      }),
    );
    expect(anonymous.status).toBe(401);
  });
});

describe("GET /api/counter/orders/[id] and POST .../cancel", () => {
  it("shows the order and cancels it", async () => {
    const { user, token } = await staffLogin();
    const { order } = await createCounterOrder(user, counterInput(), {
      now: new Date(),
    });
    const shown = await counterOrderGet(
      request(`/api/counter/orders/${order.id}`, {
        method: "GET",
        session: token,
      }),
      params(order.id),
    );
    expect(shown.status).toBe(200);
    expect(shown.headers.get("cache-control")).toContain("no-store");
    expect((await shown.json()).data).toMatchObject({
      id: order.id,
      status: "awaiting_payment",
    });

    const cancelled = await cancelPost(
      request(`/api/counter/orders/${order.id}/cancel`, { session: token }),
      params(order.id),
    );
    expect(cancelled.status).toBe(200);
    expect((await cancelled.json()).data).toEqual({ status: "expired" });

    const foreign = await cancelPost(
      request(`/api/counter/orders/${order.id}/cancel`, {
        session: token,
        origin: "https://evil.example",
      }),
      params(order.id),
    );
    expect(foreign.status).toBe(403);
  });
});

describe("POST /api/counter/orders/[id]/manual-payment", () => {
  it("is 403 ELEVATION_REQUIRED without the owner PIN, then pays with it", async () => {
    const { user, token } = await staffLogin();
    const { order } = await createCounterOrder(user, counterInput(), {
      now: new Date(),
    });
    const send = (extra: object = {}) =>
      manualPaymentPost(
        request(`/api/counter/orders/${order.id}/manual-payment`, {
          session: token,
          body: { reference: "4821", note: "", ...extra },
        }),
        params(order.id),
      );

    const refused = await send();
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.code).toBe("ELEVATION_REQUIRED");

    const elevated = await elevatePost(
      request("/api/auth/elevate", {
        session: token,
        body: { pin: owner.pin, scope: "manual_payment" },
      }),
    );
    expect(elevated.status).toBe(200);
    const { elevationId } = (await elevated.json()).data;

    const paid = await send({ elevationId });
    expect(paid.status).toBe(200);
    expect((await paid.json()).data).toMatchObject({ status: "paid" });
  });

  it("validates the reference", async () => {
    const { user, token } = await staffLogin();
    const { order } = await createCounterOrder(user, counterInput(), {
      now: new Date(),
    });
    for (const reference of ["", " ", "x".repeat(65)]) {
      const response = await manualPaymentPost(
        request(`/api/counter/orders/${order.id}/manual-payment`, {
          session: token,
          body: { reference },
        }),
        params(order.id),
      );
      expect(response.status).toBe(400);
    }
  });
});

describe("POST /api/counter/menu-items/[id]/sold-out", () => {
  it("toggles the flag for a signed-in user from the same origin", async () => {
    const { token } = await staffLogin();
    const id = catalog.items.latte.id;
    const send = (soldOut: boolean, origin?: string) =>
      soldOutPost(
        request(`/api/counter/menu-items/${id}/sold-out`, {
          session: token,
          body: { soldOut },
          origin,
        }),
        params(id),
      );
    expect((await send(true, "https://evil.example")).status).toBe(403);
    const marked = await send(true);
    expect(marked.status).toBe(200);
    expect((await marked.json()).data).toEqual({
      menuItemId: id,
      soldOut: true,
    });
    expect((await send(false)).status).toBe(200);
  });
});
