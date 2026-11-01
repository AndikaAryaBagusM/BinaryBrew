import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as unlockPost } from "@/app/api/auth/unlock/route";
import { GET as counterOrdersGet } from "@/app/api/counter/orders/route";
import { POST as statusPost } from "@/app/api/counter/orders/[id]/status/route";
import { GET as counterStreamGet } from "@/app/api/stream/counter/route";
import { closeSql, getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { randomToken } from "@/lib/ids";
import { SESSION_COOKIE } from "@/modules/auth/cookies";
import {
  pinLogin,
  resetAuthRateLimits,
  type SessionUser,
  unlock,
} from "@/modules/auth/service";
import { subscribeToOrderEvents } from "@/modules/orders/events";
import {
  advanceOrderStatus,
  createSelfOrder,
  listCounterQueue,
  resetOrderRateLimits,
} from "@/modules/orders/service";
import { mockPay } from "@/modules/payments/service";
import { createDevice, createUser, unique } from "./auth-fixtures";
import { createCatalog } from "./menu-fixtures";

// P1-10 (FR-QF-02, FR-POS-03, Flow §5, E11, E18): the Counter queue lists
// paid orders oldest first; Start → Ready → Collected move one step at a
// time and reach the customer page; the lock overlay unlocks with the same
// user's PIN in the same session.
//
// Integration files share one database: assertions look at this file's
// orders only.

afterAll(() => closeSql());

let catalog: Awaited<ReturnType<typeof createCatalog>>;
beforeAll(async () => {
  catalog = await createCatalog();
});
beforeEach(() => {
  resetOrderRateLimits();
  resetAuthRateLimits();
});

// Own business days (queue counters persist across files).
let dayOffset = 0;
const freshDay = () =>
  new Date(Date.UTC(2310, 0, 1, 5) + dayOffset++ * 86_400_000);
const later = (at: Date, ms: number) => new Date(at.getTime() + ms);
const MINUTE = 60_000;

async function paidOrder(now: Date, paidAt = now) {
  const { order, payment } = await createSelfOrder(
    {
      qrToken: catalog.qr.token,
      clientSession: randomToken(16),
      idempotencyKey: randomToken(16),
      items: [
        {
          menuItemId: catalog.items.croissant.id,
          quantity: 2,
          modifierOptionIds: [],
        },
      ],
    },
    { now },
  );
  await mockPay(payment!.id, { now: paidAt });
  return order;
}

const orderRow = async (id: string) =>
  (
    await getDb().select().from(schema.orders).where(eq(schema.orders.id, id))
  )[0]!;

async function staffLogin(role: "staff" | "barista" | "owner" = "staff") {
  const user = await createUser({ role, pin: "135790" });
  const device = await createDevice();
  const login = await pinLogin({
    userId: user.id,
    pin: user.pin,
    deviceToken: device.token,
    ip: unique("ip"),
  });
  // The session user, as route handlers see it.
  return { user: login.user, token: login.token };
}

const ids = (orders: { id: string }[]) => orders.map((o) => o.id);

describe("listCounterQueue (FR-QF-02)", () => {
  it("lists paid, preparing and ready orders oldest first, with items", async () => {
    const { user: actor } = await staffLogin();
    const day = freshDay();
    const second = await paidOrder(day, later(day, 2 * MINUTE));
    const first = await paidOrder(day, later(day, MINUTE));
    const third = await paidOrder(day, later(day, 3 * MINUTE));

    const queue = await listCounterQueue(actor);
    const mine = queue.filter((o) =>
      [first.id, second.id, third.id].includes(o.id),
    );
    expect(ids(mine)).toEqual([first.id, second.id, third.id]);
    expect(mine[0]).toMatchObject({
      queueNumber: 2,
      status: "paid",
      channel: "self_order",
      paidAt: later(day, MINUTE),
      preparingAt: null,
      readyAt: null,
      items: [{ name: catalog.items.croissant.name, quantity: 2, options: [] }],
    });
  });

  it("leaves out unpaid, completed and expired orders", async () => {
    const { user: actor } = await staffLogin();
    const day = freshDay();
    const unpaid = await createSelfOrder(
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
      { now: day },
    );
    const done = await paidOrder(day);
    await getDb()
      .update(schema.orders)
      .set({ status: "completed", completedAt: day })
      .where(eq(schema.orders.id, done.id));

    const queue = ids(await listCounterQueue(actor));
    expect(queue).not.toContain(unpaid.order.id);
    expect(queue).not.toContain(done.id);
  });

  it("needs a signed-in staff, barista or owner", async () => {
    await expect(listCounterQueue(null)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    for (const role of ["staff", "barista", "owner"] as const) {
      const { user } = await staffLogin(role);
      await expect(listCounterQueue(user)).resolves.toBeInstanceOf(Array);
    }
  });
});

describe("advanceOrderStatus (FR-QF-02, Schema §5.3)", () => {
  it("moves paid → preparing → ready → completed, stamping each step and telling the listeners", async () => {
    const { user: actor } = await staffLogin("barista");
    const day = freshDay();
    const order = await paidOrder(day);

    const events: unknown[] = [];
    const unsubscribe = await subscribeToOrderEvents((e) => events.push(e));
    try {
      const steps = [
        ["preparing", "preparingAt", MINUTE],
        ["ready", "readyAt", 4 * MINUTE],
        ["completed", "completedAt", 6 * MINUTE],
      ] as const;
      for (const [status, column, offset] of steps) {
        const at = later(day, offset);
        expect(
          await advanceOrderStatus(
            actor,
            { orderId: order.id, status },
            { now: at },
          ),
        ).toEqual({ status, queueNumber: 1 });
        expect(await orderRow(order.id)).toMatchObject({
          status,
          [column]: at,
        });
      }
      await expect
        .poll(
          () =>
            events.filter(
              (e) => (e as { orderId: string }).orderId === order.id,
            ).length,
        )
        .toBe(3);
    } finally {
      await unsubscribe();
    }
    expect(
      events.filter((e) => (e as { orderId: string }).orderId === order.id),
    ).toEqual([
      { orderId: order.id, status: "preparing", queueNumber: 1 },
      { orderId: order.id, status: "ready", queueNumber: 1 },
      { orderId: order.id, status: "completed", queueNumber: 1 },
    ]);
  });

  it("refuses skipping a step or going back (BR-01), naming the current status", async () => {
    const { user: actor } = await staffLogin();
    const order = await paidOrder(freshDay());
    await expect(
      advanceOrderStatus(actor, { orderId: order.id, status: "ready" }),
    ).rejects.toMatchObject({
      code: "ORDER_STATUS_CHANGED",
      details: { status: "paid" },
    });
    await advanceOrderStatus(actor, { orderId: order.id, status: "preparing" });
    await advanceOrderStatus(actor, { orderId: order.id, status: "ready" });
    await expect(
      advanceOrderStatus(actor, { orderId: order.id, status: "preparing" }),
    ).rejects.toMatchObject({
      code: "ORDER_STATUS_CHANGED",
      details: { status: "ready" },
    });
  });

  it("refuses unpaid orders", async () => {
    const { user: actor } = await staffLogin();
    const { order } = await createSelfOrder(
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
      { now: freshDay() },
    );
    await expect(
      advanceOrderStatus(actor, { orderId: order.id, status: "preparing" }),
    ).rejects.toMatchObject({
      code: "ORDER_STATUS_CHANGED",
      details: { status: "awaiting_payment" },
    });
  });

  it("two staff tapping at once: one moves the order, the other is told (E18)", async () => {
    const { user: a } = await staffLogin();
    const { user: b } = await staffLogin();
    const order = await paidOrder(freshDay());
    const results = await Promise.allSettled([
      advanceOrderStatus(a, { orderId: order.id, status: "preparing" }),
      advanceOrderStatus(b, { orderId: order.id, status: "preparing" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toMatchObject({
      code: "ORDER_STATUS_CHANGED",
      details: { status: "preparing" },
    });
  });

  it("needs a session and a known order", async () => {
    const order = await paidOrder(freshDay());
    await expect(
      advanceOrderStatus(null, { orderId: order.id, status: "preparing" }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const { user: actor } = await staffLogin();
    await expect(
      advanceOrderStatus(actor, {
        orderId: crypto.randomUUID(),
        status: "preparing",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("unlock (Tech §9 auto-lock, Flow E11)", () => {
  it("accepts the signed-in user's PIN and keeps the session", async () => {
    const { user, token } = await staffLogin();
    await expect(
      unlock(user, { pin: "135790", ip: unique("ip") }),
    ).resolves.toBeUndefined();
    const response = await counterOrdersGet(
      request("/api/counter/orders", { method: "GET", session: token }),
    );
    expect(response.status).toBe(200);
  });

  it("counts wrong PINs toward the 5-minute lockout", async () => {
    const { user } = await staffLogin();
    for (const remaining of [4, 3, 2, 1]) {
      await expect(
        unlock(user, { pin: "000000", ip: unique("ip") }),
      ).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
        details: { remainingAttempts: remaining },
      });
    }
    await expect(
      unlock(user, { pin: "000000", ip: unique("ip") }),
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
    // Locked: even the right PIN waits.
    await expect(
      unlock(user, { pin: "135790", ip: unique("ip") }),
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
  });

  it("checks the session's own user, not another one", async () => {
    const { user } = await staffLogin();
    const other = await createUser({ pin: "246802" });
    await expect(
      unlock(user, { pin: other.pin, ip: unique("ip") }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("needs a session", async () => {
    await expect(
      unlock(null as unknown as SessionUser, { pin: "1234", ip: "x" }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
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
  } = {},
) {
  const headers = new Headers({
    host: new URL(BASE).host,
    "content-type": "application/json",
    "x-forwarded-for": unique("ip"),
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

const statusRequest = (
  id: string,
  body: unknown,
  options: { session?: string; origin?: string | null } = {},
) =>
  statusPost(
    request(`/api/counter/orders/${id}/status`, { body, ...options }),
    { params: Promise.resolve({ id }) },
  );

describe("GET /api/counter/orders", () => {
  it("returns the queue as JSON for a signed-in user, no-store", async () => {
    const { token } = await staffLogin();
    const order = await paidOrder(freshDay());
    const response = await counterOrdersGet(
      request("/api/counter/orders", { method: "GET", session: token }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const { data } = await response.json();
    const mine = data.orders.find((o: { id: string }) => o.id === order.id);
    expect(mine).toMatchObject({ status: "paid", queueNumber: 1 });
    expect(typeof mine.paidAt).toBe("string");
  });

  it("answers 401 without a session", async () => {
    const response = await counterOrdersGet(
      request("/api/counter/orders", { method: "GET" }),
    );
    expect(response.status).toBe(401);
  });
});

describe("POST /api/counter/orders/{id}/status", () => {
  it("moves the order and returns the new status", async () => {
    const { token } = await staffLogin();
    const order = await paidOrder(freshDay());
    const response = await statusRequest(
      order.id,
      { status: "preparing" },
      { session: token },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { status: "preparing", queueNumber: 1 },
    });
  });

  it("answers 409 with the current status when it already changed", async () => {
    const { token } = await staffLogin();
    const order = await paidOrder(freshDay());
    const response = await statusRequest(
      order.id,
      { status: "ready" },
      { session: token },
    );
    expect(response.status).toBe(409);
    const { error } = await response.json();
    expect(error).toMatchObject({
      code: "ORDER_STATUS_CHANGED",
      details: { status: "paid" },
    });
    expect(error.message).toBeTruthy();
  });

  it("refuses other statuses, extra fields, a bad id, other origins and no session", async () => {
    const { token } = await staffLogin();
    const order = await paidOrder(freshDay());
    for (const body of [
      { status: "paid" },
      { status: "voided" },
      { status: "preparing", queueNumber: 9 },
    ]) {
      expect(
        (await statusRequest(order.id, body, { session: token })).status,
      ).toBe(400);
    }
    expect(
      (
        await statusRequest(
          "not-a-uuid",
          { status: "preparing" },
          { session: token },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await statusRequest(
          order.id,
          { status: "preparing" },
          { session: token, origin: "http://evil.test" },
        )
      ).status,
    ).toBe(403);
    expect(
      (await statusRequest(order.id, { status: "preparing" })).status,
    ).toBe(401);
    expect((await orderRow(order.id)).status).toBe("paid");
  });
});

describe("POST /api/auth/unlock", () => {
  it("answers 200 for the right PIN and 401 with attempts left for a wrong one", async () => {
    const { token } = await staffLogin();
    const ok = await unlockPost(
      request("/api/auth/unlock", { body: { pin: "135790" }, session: token }),
    );
    expect(ok.status).toBe(200);
    // The session cookie is not replaced.
    expect(ok.cookies.get(SESSION_COOKIE)).toBeUndefined();

    const wrong = await unlockPost(
      request("/api/auth/unlock", { body: { pin: "000000" }, session: token }),
    );
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error.message).toBe(
      "PIN salah. Sisa percobaan: 4",
    );
  });

  it("refuses no session, other origins and a malformed PIN", async () => {
    const { token } = await staffLogin();
    expect(
      (await unlockPost(request("/api/auth/unlock", { body: { pin: "1234" } })))
        .status,
    ).toBe(401);
    expect(
      (
        await unlockPost(
          request("/api/auth/unlock", {
            body: { pin: "135790" },
            session: token,
            origin: "http://evil.test",
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await unlockPost(
          request("/api/auth/unlock", { body: { pin: "12" }, session: token }),
        )
      ).status,
    ).toBe(400);
  });
});

describe("GET /api/stream/counter", () => {
  it("streams order events to a signed-in user", async () => {
    const { token } = await staffLogin();
    const req = new NextRequest(`${BASE}/api/stream/counter`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    const response = await counterStreamGet(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (part: string) => {
      while (!text.includes(part)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    // `sync` says the stream is listening: refetch now, nothing is missed.
    await readUntil("event: sync\n");
    const order = await paidOrder(freshDay());
    await readUntil(order.id);
    // Cancelling waits for the stream to stop listening.
    await reader.cancel();
    expect(text).toContain("event: order\n");
    expect(text).toContain(
      JSON.stringify({ orderId: order.id, status: "paid", queueNumber: 1 }),
    );
  });

  it("answers 401 without a session", async () => {
    const response = await counterStreamGet(
      new NextRequest(`${BASE}/api/stream/counter`),
    );
    expect(response.status).toBe(401);
  });
});
