import { inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as boardGet } from "@/app/api/public/board/route";
import { GET as boardStreamGet } from "@/app/api/stream/board/route";
import { closeSql, getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { randomToken } from "@/lib/ids";
import { pinLogin, resetAuthRateLimits } from "@/modules/auth/service";
import {
  advanceOrderStatus,
  createSelfOrder,
  getBoard,
  resetOrderRateLimits,
} from "@/modules/orders/service";
import { mockPay } from "@/modules/payments/service";
import { createDevice, createUser, unique } from "./auth-fixtures";
import { createCatalog } from "./menu-fixtures";

// P1-12 (FR-QF-04, D19): the TV board lists Preparing and Ready queue
// numbers only, and its public stream carries no order data.

afterAll(() => closeSql());

let catalog: Awaited<ReturnType<typeof createCatalog>>;
beforeAll(async () => {
  catalog = await createCatalog();
});
beforeEach(async () => {
  resetOrderRateLimits();
  resetAuthRateLimits();
  // The board shows every unfinished order; finish the ones other files
  // left behind so this file sees only its own.
  await getDb()
    .update(schema.orders)
    .set({ status: "completed", completedAt: new Date() })
    .where(inArray(schema.orders.status, ["preparing", "ready"]));
});

// Own business days (queue counters persist across files).
let dayOffset = 0;
const freshDay = () =>
  new Date(Date.UTC(2320, 0, 1, 5) + dayOffset++ * 86_400_000);
const later = (at: Date, ms: number) => new Date(at.getTime() + ms);
const MINUTE = 60_000;

async function paidOrder(now: Date) {
  const { order, payment } = await createSelfOrder(
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
  await mockPay(payment!.id, { now });
  return order;
}

async function barista() {
  const user = await createUser({ role: "barista", pin: "135790" });
  const device = await createDevice();
  const login = await pinLogin({
    userId: user.id,
    pin: user.pin,
    deviceToken: device.token,
    ip: unique("ip"),
  });
  return login.user;
}

describe("getBoard (FR-QF-04)", () => {
  it("lists preparing oldest first and ready newest first, numbers only", async () => {
    const actor = await barista();
    const day = freshDay();
    const orders: { id: string }[] = [];
    for (let i = 0; i < 5; i++) orders.push(await paidOrder(day)); // #1..#5
    const move = (index: number, status: "preparing" | "ready", at: number) =>
      advanceOrderStatus(
        actor,
        { orderId: orders[index]!.id, status },
        { now: later(day, at * MINUTE) },
      );
    // #1 stays paid: not on the board yet.
    await move(2, "preparing", 1);
    await move(1, "preparing", 2);
    await move(3, "preparing", 3);
    await move(3, "ready", 4);
    await move(4, "preparing", 5);
    await move(4, "ready", 6);

    expect(await getBoard()).toEqual({ preparing: [3, 2], ready: [5, 4] });
  });

  it("drops a number once the order is collected", async () => {
    const actor = await barista();
    const order = await paidOrder(freshDay());
    for (const status of ["preparing", "ready"] as const) {
      await advanceOrderStatus(actor, { orderId: order.id, status });
    }
    expect(await getBoard()).toEqual({ preparing: [], ready: [1] });
    await advanceOrderStatus(actor, { orderId: order.id, status: "completed" });
    expect(await getBoard()).toEqual({ preparing: [], ready: [] });
  });
});

const BASE = "http://localhost:3000";

describe("GET /api/public/board", () => {
  it("is public, uncached and carries only the two number lists", async () => {
    const actor = await barista();
    const order = await paidOrder(freshDay());
    await advanceOrderStatus(actor, { orderId: order.id, status: "preparing" });

    const response = await boardGet(
      new NextRequest(`${BASE}/api/public/board`),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      data: { preparing: [1], ready: [] },
    });
  });
});

describe("GET /api/stream/board", () => {
  it("is public and signals changes without order data", async () => {
    const response = await boardStreamGet(
      new NextRequest(`${BASE}/api/stream/board`),
    );
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
    await readUntil("event: sync\n");
    const actor = await barista();
    const order = await paidOrder(freshDay());
    await advanceOrderStatus(actor, { orderId: order.id, status: "preparing" });
    await readUntil("event: change\n");
    await reader.cancel();

    expect(text).toContain("event: change\ndata: {}\n");
    expect(text).not.toContain(order.id);
    expect(text).not.toContain(order.publicToken);
    expect(text).not.toContain("queueNumber");
  });
});
