import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as csvGet } from "@/app/api/owner/reports/hpp/csv/route";
import { GET as reportGet } from "@/app/api/owner/reports/hpp/route";
import { closeSql, getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { SESSION_COOKIE } from "@/modules/auth/cookies";
import {
  ownerLogin,
  pinLogin,
  resetAuthRateLimits,
  type SessionUser,
} from "@/modules/auth/service";
import { createIngredient } from "@/modules/inventory/service";
import { getOwnerMenu, setRecipe } from "@/modules/menu/service";
import {
  createCounterOrder,
  resetOrderRateLimits,
} from "@/modules/orders/service";
import {
  handlePaymentWebhook,
  signedMockPaidEvent,
} from "@/modules/payments/service";
import { getHppReport } from "@/modules/reports/service";
import { createDevice, createUser, unique } from "./auth-fixtures";
import { createCatalog } from "./menu-fixtures";

// P2-06 acceptance (O-09, FR-HP-01, 02, 04): the report equals a hand
// calculation for three items (complete, incomplete, low margin) plus one
// without a recipe; sales of a month use the unit_cogs stored at payment.

const SETTINGS = ["low_margin_threshold_pct", "business_day_cutoff"];
const clearSettings = () =>
  getDb().delete(schema.settings).where(inArray(schema.settings.key, SETTINGS));

afterAll(async () => {
  await clearSettings();
  await closeSql();
});
beforeEach(async () => {
  resetAuthRateLimits();
  resetOrderRateLimits();
  await clearSettings();
});

type Login = { user: SessionUser; token: string };
let owner: Login;
let staff: Login;
let catalog: Awaited<ReturnType<typeof createCatalog>>;

// Hand calculation (threshold 30 %):
// - Kopi: 18 g beans × Rp 285 + 150 ml milk × Rp 20 = 5.130 + 3.000 = 8.130;
//   price 25.000 → margin 16.870, 67,48 % → 67,5 %.
// - Teh: 18 g beans + 20 ml syrup (no cost yet, counted 0) = 5.130;
//   price 15.000 → margin 9.870, 65,8 %, "Resep belum lengkap".
// - Mocha: 50 g beans = 14.250; price 18.000 → margin 3.750, 20,83 % →
//   20,8 %, below 30 %: "Margin rendah".
// - Roti: no recipe → no HPP, no margin, "Resep belum ada".
let items: Record<
  "kopi" | "teh" | "mocha" | "roti",
  { id: string; name: string }
>;
let beans: string;
let milk: string;

async function ingredient(stock: number, unitCost: number) {
  const { id } = await createIngredient(owner.user, {
    name: unique("Bahan"),
    kind: "raw",
    unit: "g",
    minStockQty: "0",
    isActive: true,
    opening:
      unitCost > 0
        ? { quantity: String(stock), totalCost: stock * unitCost }
        : null,
  });
  return id;
}

async function menuItem(name: string, price: number) {
  const [row] = await getDb()
    .insert(schema.menuItems)
    .values({
      categoryId: catalog.categories.drinks.id,
      name: unique(name),
      price,
    })
    .returning({ id: schema.menuItems.id, name: schema.menuItems.name });
  return row!;
}

beforeAll(async () => {
  const ownerRow = await createUser({ role: "owner" });
  owner = await ownerLogin({
    email: ownerRow.email!,
    password: ownerRow.password,
    ip: unique("ip"),
  });
  const staffRow = await createUser({ role: "staff", pin: "864200" });
  const device = await createDevice();
  staff = await pinLogin({
    userId: staffRow.id,
    pin: staffRow.pin,
    deviceToken: device.token,
    ip: unique("ip"),
  });
  catalog = await createCatalog();

  beans = await ingredient(100_000, 285);
  milk = await ingredient(100_000, 20);
  const syrup = await ingredient(0, 0);
  items = {
    kopi: await menuItem("Kopi", 25_000),
    teh: await menuItem("Teh", 15_000),
    mocha: await menuItem("Mocha", 18_000),
    roti: await menuItem("Roti", 20_000),
  };
  await setRecipe(owner.user, items.kopi.id, [
    { ingredientId: beans, qty: "18" },
    { ingredientId: milk, qty: "150" },
  ]);
  await setRecipe(owner.user, items.teh.id, [
    { ingredientId: beans, qty: "18" },
    { ingredientId: syrup, qty: "20" },
  ]);
  await setRecipe(owner.user, items.mocha.id, [
    { ingredientId: beans, qty: "50" },
  ]);
});

const BASE = "http://localhost:3000";
const request = (path: string, session: string) =>
  new NextRequest(`${BASE}${path}`, {
    headers: {
      host: new URL(BASE).host,
      cookie: `${SESSION_COOKIE}=${session}`,
    },
  });

// 15 June 2107, noon in Jakarta: a month no other test sells in.
const NOW = new Date(Date.UTC(2107, 5, 15, 5));
const MONTH = "2107-06";

async function paidOrder(
  lines: { menuItemId: string; quantity: number }[],
  { pay = true } = {},
) {
  const { order, payment } = await createCounterOrder(
    staff.user,
    {
      clientSession: randomBytes(16).toString("base64url"),
      idempotencyKey: randomBytes(16).toString("base64url"),
      items: lines.map((line) => ({ ...line, modifierOptionIds: [] })),
    },
    { now: NOW },
  );
  if (pay) {
    const event = await signedMockPaidEvent(payment!.id);
    await handlePaymentWebhook("mock", event.body, event.headers, {
      now: NOW,
    });
  }
  return order;
}

describe("current HPP and margin (FR-HP-01, 02)", () => {
  it("equals the hand calculation for three items, and none without a recipe", async () => {
    const report = await getHppReport(owner.user, { now: NOW });
    expect(report.thresholdPct).toBe(30);
    const row = (id: string) => report.items.find((item) => item.id === id);
    expect(row(items.kopi.id)).toEqual({
      id: items.kopi.id,
      name: items.kopi.name,
      price: 25_000,
      status: "complete",
      hpp: 8130,
      margin: 16_870,
      marginPermille: 675,
      lowMargin: false,
    });
    expect(row(items.teh.id)).toMatchObject({
      status: "incomplete",
      hpp: 5130,
      margin: 9870,
      marginPermille: 658,
      lowMargin: false,
    });
    expect(row(items.mocha.id)).toMatchObject({
      status: "complete",
      hpp: 14_250,
      margin: 3750,
      marginPermille: 208,
      lowMargin: true,
    });
    expect(row(items.roti.id)).toMatchObject({
      status: "no_recipe",
      hpp: null,
      margin: null,
      marginPermille: null,
      lowMargin: false,
    });
    // Lowest margin first, items without a recipe after every other.
    const order = report.items.map((item) => item.id);
    expect(order.indexOf(items.mocha.id)).toBeLessThan(
      order.indexOf(items.teh.id),
    );
    expect(order.indexOf(items.teh.id)).toBeLessThan(
      order.indexOf(items.kopi.id),
    );
    expect(
      report.items
        .slice(order.indexOf(items.roti.id))
        .every((item) => item.hpp === null),
    ).toBe(true);
  });

  it("follows the owner's threshold", async () => {
    await getDb()
      .insert(schema.settings)
      .values({ key: "low_margin_threshold_pct", value: 66 });
    const report = await getHppReport(owner.user, { now: NOW });
    const low = (id: string) =>
      report.items.find((item) => item.id === id)!.lowMargin;
    expect([
      low(items.mocha.id),
      low(items.teh.id),
      low(items.kopi.id),
    ]).toEqual([
      true,
      true, // 65,8 %
      false, // 67,5 %
    ]);
  });

  it("shows the same HPP on O-03", async () => {
    const menu = await getOwnerMenu(owner.user);
    const cost = (id: string) =>
      menu.items.find((item) => item.id === id)!.cost;
    expect(cost(items.kopi.id)).toEqual({ status: "complete", hpp: 8130 });
    expect(cost(items.teh.id)).toEqual({ status: "incomplete", hpp: 5130 });
    expect(cost(items.roti.id)).toEqual({ status: "no_recipe", hpp: null });
  });
});

describe("sales per period (FR-HP-04)", () => {
  it("uses unit_cogs from payment; voided and unpaid orders are left out", async () => {
    await paidOrder([
      { menuItemId: items.kopi.id, quantity: 2 },
      { menuItemId: items.roti.id, quantity: 1 },
    ]);
    const voided = await paidOrder([
      { menuItemId: items.kopi.id, quantity: 5 },
    ]);
    await getDb()
      .update(schema.orders)
      .set({
        status: "voided",
        voidReason: "test",
        voidedBy: owner.user.userId,
        voidedAt: NOW,
      })
      .where(eq(schema.orders.id, voided.id));
    await paidOrder([{ menuItemId: items.kopi.id, quantity: 1 }], {
      pay: false,
    });

    // A recipe change after payment moves the current HPP, not the sale's.
    await setRecipe(owner.user, items.kopi.id, [
      { ingredientId: beans, qty: "40" },
    ]);

    const report = await getHppReport(owner.user, { month: MONTH, now: NOW });
    expect(report.period.month).toBe(MONTH);
    expect(report.period.months[0]).toBe(MONTH);
    expect(report.period.months.length).toBeLessThanOrEqual(24);
    expect(report.period.rows).toEqual([
      {
        menuItemId: items.kopi.id,
        name: items.kopi.name,
        quantity: 2,
        revenue: 50_000,
        cogs: 16_260, // 2 × 8.130, stored at payment
        uncostedQuantity: 0,
        margin: 33_740,
        marginPermille: 675,
      },
      {
        menuItemId: items.roti.id,
        name: items.roti.name,
        quantity: 1,
        revenue: 20_000,
        cogs: 0,
        uncostedQuantity: 1, // no recipe: no unit_cogs
        margin: null,
        marginPermille: null,
      },
    ]);
    expect(report.period.totals).toEqual({
      quantity: 3,
      revenue: 70_000,
      cogs: 16_260,
      uncostedQuantity: 1,
      margin: null,
      marginPermille: null,
    });
    // Current HPP after the recipe change: 40 g × Rp 285 = 11.400.
    expect(report.items.find((item) => item.id === items.kopi.id)!.hpp).toBe(
      11_400,
    );

    // Restore the recipe for the other tests.
    await setRecipe(owner.user, items.kopi.id, [
      { ingredientId: beans, qty: "18" },
      { ingredientId: milk, qty: "150" },
    ]);
  });

  it("refuses a month outside the offered list", async () => {
    await expect(
      getHppReport(owner.user, { month: "2090-01", now: NOW }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("routes (owner only)", () => {
  it("returns the report, never cached; staff are refused", async () => {
    const response = await reportGet(
      request(`/api/owner/reports/hpp`, owner.token),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { data } = await response.json();
    expect(data.items.length).toBeGreaterThan(0);

    expect(
      (await reportGet(request(`/api/owner/reports/hpp`, staff.token))).status,
    ).toBe(403);
    expect(
      (
        await reportGet(
          request(`/api/owner/reports/hpp?month=2107-13`, owner.token),
        )
      ).status,
    ).toBe(400);
  });

  it("downloads the report as CSV", async () => {
    const response = await csvGet(
      request(`/api/owner/reports/hpp/csv`, owner.token),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="hpp-margin-\d{4}-\d{2}\.csv"$/,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A UTF-8 byte order mark, so spreadsheet apps read the names right.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder().decode(bytes.slice(3));
    expect(body.startsWith("Menu,Harga,HPP,Margin,Margin %,Catatan\r\n")).toBe(
      true,
    );
    expect(body).toContain(
      `\r\n${items.mocha.name},18000,14250,3750,20.8,Margin rendah\r\n`,
    );
    expect(body).toContain(
      `\r\n${items.roti.name},20000,,,,Resep belum ada\r\n`,
    );
    expect(
      (await csvGet(request(`/api/owner/reports/hpp/csv`, staff.token))).status,
    ).toBe(403);
  });
});
