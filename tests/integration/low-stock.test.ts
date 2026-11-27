import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as lowStockGet } from "@/app/api/owner/low-stock/route";
import { GET as ownerStreamGet } from "@/app/api/stream/owner/route";
import { closeSql, getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { SESSION_COOKIE } from "@/modules/auth/cookies";
import {
  ownerLogin,
  pinLogin,
  resetAuthRateLimits,
  type SessionUser,
} from "@/modules/auth/service";
import {
  type StockEvent,
  subscribeToStockEvents,
} from "@/modules/inventory/events";
import {
  createIngredient,
  getLowStock,
  updateIngredient,
} from "@/modules/inventory/service";
import { setRecipe } from "@/modules/menu/service";
import {
  createCounterOrder,
  resetOrderRateLimits,
} from "@/modules/orders/service";
import {
  handlePaymentWebhook,
  signedMockPaidEvent,
} from "@/modules/payments/service";
import { createDevice, createUser, unique } from "./auth-fixtures";
import { createCatalog } from "./menu-fixtures";

// P2-07 acceptance (FR-IV-06): a paid sale that takes an ingredient to its
// minimum sends stock.low once, after the payment commits; the owner's list
// holds every active ingredient at or below its minimum, worst first.

afterAll(() => closeSql());
beforeEach(() => {
  resetAuthRateLimits();
  resetOrderRateLimits();
});

type Login = { user: SessionUser; token: string };
let owner: Login;
let staff: Login;
let catalog: Awaited<ReturnType<typeof createCatalog>>;
// beans: 1.000 g, minimum 600 g, 300 g per Kopi → the second Kopi crosses.
// sugar: already low (100 g, minimum 500 g), 10 g per Kopi.
// old: low but switched off, so never listed.
let beans: string;
let sugar: string;
let old: string;
let kopi: string;

async function ingredient(stock: number, min: number) {
  const { id } = await createIngredient(owner.user, {
    name: unique("Bahan"),
    kind: "raw",
    unit: "g",
    minStockQty: String(min),
    isActive: true,
    opening: { quantity: String(stock), totalCost: stock * 10 },
  });
  return id;
}

beforeAll(async () => {
  const ownerRow = await createUser({ role: "owner" });
  owner = await ownerLogin({
    email: ownerRow.email!,
    password: ownerRow.password,
    ip: unique("ip"),
  });
  const staffRow = await createUser({ role: "staff", pin: "864211" });
  const device = await createDevice();
  staff = await pinLogin({
    userId: staffRow.id,
    pin: staffRow.pin,
    deviceToken: device.token,
    ip: unique("ip"),
  });
  catalog = await createCatalog();
  beans = await ingredient(1000, 600);
  sugar = await ingredient(100, 500);
  old = await ingredient(50, 100);
  await updateIngredient(owner.user, old, { isActive: false });
  const [row] = await getDb()
    .insert(schema.menuItems)
    .values({
      categoryId: catalog.categories.drinks.id,
      name: unique("Kopi"),
      price: 20_000,
    })
    .returning({ id: schema.menuItems.id });
  kopi = row!.id;
  await setRecipe(owner.user, kopi, [
    { ingredientId: beans, qty: "300" },
    { ingredientId: sugar, qty: "10" },
  ]);
});

const NOW = new Date(Date.UTC(2108, 2, 3, 5));

async function sellKopi({ pay = true } = {}) {
  const { payment } = await createCounterOrder(
    staff.user,
    {
      clientSession: randomBytes(16).toString("base64url"),
      idempotencyKey: randomBytes(16).toString("base64url"),
      items: [{ menuItemId: kopi, quantity: 1, modifierOptionIds: [] }],
    },
    { now: NOW },
  );
  if (pay) {
    const event = await signedMockPaidEvent(payment!.id);
    await handlePaymentWebhook("mock", event.body, event.headers, {
      now: NOW,
    });
  }
}

const notify = (ingredientIds: string[]) =>
  getDb().execute(
    sql`select pg_notify('stock_events', ${JSON.stringify({ type: "stock.low", ingredientIds })})`,
  );

const ours = (ids: string[]) =>
  ids.filter((id) => [beans, sugar, old].includes(id));

describe("stock.low (FR-IV-06)", () => {
  it("fires once, for the sale that reaches the minimum", async () => {
    const events: StockEvent[] = [];
    const unsubscribe = await subscribeToStockEvents((event) =>
      events.push(event),
    );
    const seen = () => events.flatMap((event) => ours(event.ingredientIds));
    try {
      await sellKopi(); // beans 1.000 → 700: still above 600
      await sellKopi({ pay: false }); // unpaid: nothing deducted
      await sellKopi(); // beans 700 → 400: crosses
      await expect.poll(seen).toEqual([beans]);
      await sellKopi(); // beans 400 → 100: already low, no second alert
      // A later event proves the earlier sales were delivered by now.
      await notify([old]);
      await expect.poll(() => seen().includes(old)).toBe(true);
    } finally {
      await unsubscribe();
    }
    // Sugar was already low before any sale: never announced.
    expect(seen()).toEqual([beans, old]);
  });

  it("lists active ingredients at or below their minimum", async () => {
    const items = (await getLowStock(owner.user)).filter((item) =>
      [beans, sugar, old].includes(item.id),
    );
    // The switched-off one is left out; the order is the unit test's.
    expect(items).toHaveLength(2);
    expect(items).toEqual(
      expect.arrayContaining([
        {
          id: beans,
          name: expect.any(String),
          unit: "g",
          stockQty: "100.000",
          minStockQty: "600.000",
          status: "low",
        },
        expect.objectContaining({
          id: sugar,
          stockQty: "70.000",
          status: "low",
        }),
      ]),
    );
  });
});

const BASE = "http://localhost:3000";
const request = (path: string, session: string, signal?: AbortSignal) =>
  new NextRequest(`${BASE}${path}`, {
    headers: {
      host: new URL(BASE).host,
      cookie: `${SESSION_COOKIE}=${session}`,
    },
    signal,
  });

describe("owner routes", () => {
  it("GET /api/owner/low-stock is owner only and never cached", async () => {
    const response = await lowStockGet(
      request("/api/owner/low-stock", owner.token),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { data } = await response.json();
    expect(data.items.map((item: { id: string }) => item.id)).toContain(sugar);
    expect(
      (await lowStockGet(request("/api/owner/low-stock", staff.token))).status,
    ).toBe(403);
  });

  it("the owner stream relays stock.low; staff are refused", async () => {
    expect(
      (await ownerStreamGet(request("/api/stream/owner", staff.token))).status,
    ).toBe(403);

    const abort = new AbortController();
    const response = await ownerStreamGet(
      request("/api/stream/owner", owner.token, abort.signal),
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
    await notify([sugar]);
    await readUntil("event: stock\n");
    await reader.cancel();
    abort.abort();
    expect(text).toContain(
      `event: stock\ndata: ${JSON.stringify({ ingredientIds: [sugar] })}\n`,
    );
  });
});
