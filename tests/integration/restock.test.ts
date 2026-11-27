import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as optionsGet } from "@/app/api/counter/restock-options/route";
import { POST as restocksPost } from "@/app/api/counter/restocks/route";
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
  createIngredient,
  createSupplier,
  getRestockOptions,
  recordRestocks,
  type RestockLine,
  updateIngredient,
  updateSupplier,
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
import { stockLedgerMismatches } from "./stock-ledger";

// P2-05 (FR-IV-05, BR-09; Schema §5.5): staff and the owner record
// purchases; each one adds stock through the ledger and moves the
// weighted-average cost. Acceptance: average cost for zero and negative
// starting stock (also unit-tested in tests/unit/restock.test.ts), and the
// new average the screens preview is the one the server stores.

afterAll(() => closeSql());
beforeEach(() => {
  resetAuthRateLimits();
  resetOrderRateLimits();
});

type Login = { user: SessionUser; token: string };
let owner: Login;
let staff: Login;
let barista: Login;

async function pinUser(role: "staff" | "barista", pin: string) {
  const row = await createUser({ role, pin });
  const device = await createDevice();
  return pinLogin({
    userId: row.id,
    pin: row.pin,
    deviceToken: device.token,
    ip: unique("ip"),
  });
}

beforeAll(async () => {
  const ownerRow = await createUser({ role: "owner" });
  owner = await ownerLogin({
    email: ownerRow.email!,
    password: ownerRow.password,
    ip: unique("ip"),
  });
  staff = await pinUser("staff", "246810");
  barista = await pinUser("barista", "975310");
});

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

// An ingredient with opening stock bought for `stock × unitCost` rupiah.
async function ingredient(stock: number, unitCost: number, unit = "ml") {
  const { id } = await createIngredient(owner.user, {
    name: unique("Susu"),
    kind: "raw",
    unit: unit as "ml",
    minStockQty: "0",
    isActive: true,
    opening:
      stock > 0
        ? { quantity: String(stock), totalCost: stock * unitCost }
        : null,
  });
  return id;
}

const supplier = async () =>
  (
    await createSupplier(owner.user, {
      name: unique("Toko"),
      note: null,
      isActive: true,
    })
  ).id;

const line = (
  ingredientId: string,
  quantity: string,
  totalCost: number,
  more: Partial<RestockLine> = {},
): RestockLine => ({
  ingredientId,
  quantity,
  totalCost,
  supplierId: null,
  purchasedOn: null,
  ...more,
});

async function ingredientRow(id: string) {
  const [row] = await getDb()
    .select({
      stockQty: schema.ingredients.stockQty,
      avgCost: schema.ingredients.avgCost,
    })
    .from(schema.ingredients)
    .where(eq(schema.ingredients.id, id));
  return row!;
}

const restocksOf = (ingredientId: string) =>
  getDb()
    .select()
    .from(schema.restocks)
    .where(eq(schema.restocks.ingredientId, ingredientId));

const movementsOf = (ingredientId: string) =>
  getDb()
    .select({
      type: schema.stockMovements.type,
      qtyDelta: schema.stockMovements.qtyDelta,
      refType: schema.stockMovements.refType,
      refId: schema.stockMovements.refId,
      createdBy: schema.stockMovements.createdBy,
    })
    .from(schema.stockMovements)
    .where(eq(schema.stockMovements.ingredientId, ingredientId))
    .orderBy(schema.stockMovements.id);

// 2100-01-01 18:00 UTC is 2 Jan 01:00 in Jakarta: the shop's calendar date
// is 2100-01-02 (purchases use the calendar day, not the business day).
const NOW = new Date(Date.UTC(2100, 0, 1, 18));
const TODAY = "2100-01-02";

describe("recording a purchase (FR-IV-05)", () => {
  it("adds stock through the ledger and moves the average cost (Figma O-07)", async () => {
    const milk = await ingredient(4200, 179);
    // 4.200 ml for Rp 751.800 = Rp 179 / ml; buy 6.000 ml for Rp 108.000.
    const toko = await supplier();
    const { restocks } = await recordRestocks(
      staff.user,
      { lines: [line(milk, "6000", 108_000, { supplierId: toko })] },
      { now: NOW },
    );
    // (4.200 × 179 + 108.000) / 10.200 = Rp 84,2941 / ml.
    expect(restocks).toEqual([
      {
        id: expect.any(String),
        ingredientId: milk,
        avgCostBefore: "179.0000",
        avgCostAfter: "84.2941",
        stockQty: "10200.000",
      },
    ]);
    expect(await ingredientRow(milk)).toEqual({
      stockQty: "10200.000",
      avgCost: "84.2941",
    });
    expect(await restocksOf(milk)).toEqual([
      expect.objectContaining({
        id: restocks[0]!.id,
        supplierId: toko,
        quantity: "6000.000",
        totalCost: 108_000,
        unitCost: "18.0000",
        purchasedOn: TODAY,
        createdBy: staff.user.userId,
      }),
    ]);
    expect((await movementsOf(milk)).at(-1)).toEqual({
      type: "restock",
      qtyDelta: "6000.000",
      refType: "restock",
      refId: restocks[0]!.id,
      createdBy: staff.user.userId,
    });
    const [log] = await getDb()
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.action, "restock.create"),
          eq(schema.auditLogs.entityId, restocks[0]!.id),
        ),
      );
    expect(log).toMatchObject({
      actorUserId: staff.user.userId,
      entityType: "restock",
      metadata: {
        ingredientId: milk,
        quantity: "6000.000",
        totalCost: 108_000,
        supplierId: toko,
        purchasedOn: TODAY,
        avgCost: { from: "179.0000", to: "84.2941" },
        stockQty: { from: "4200.000", to: "10200.000" },
      },
    });
    expect(await stockLedgerMismatches()).toEqual([]);
  });

  it("uses the purchase price when stock is zero or negative (BR-09)", async () => {
    const empty = await ingredient(0, 0);
    const minus = await ingredient(10, 500);
    // Take minus to -6 ml the way a sale would: through the ledger.
    await getDb().transaction(async (tx) => {
      await tx.insert(schema.stockMovements).values({
        ingredientId: minus,
        type: "sale_deduction",
        qtyDelta: "-16.000",
      });
      await tx
        .update(schema.ingredients)
        .set({ stockQty: "-6.000" })
        .where(eq(schema.ingredients.id, minus));
    });
    await recordRestocks(owner.user, {
      lines: [line(empty, "1000", 300_000), line(minus, "1000", 300_000)],
    });
    expect(await ingredientRow(empty)).toEqual({
      stockQty: "1000.000",
      avgCost: "300.0000",
    });
    // Stock goes back up by the whole purchase; the minus does not distort
    // the average.
    expect(await ingredientRow(minus)).toEqual({
      stockQty: "994.000",
      avgCost: "300.0000",
    });
    expect(await stockLedgerMismatches()).toEqual([]);
  });

  it("applies the same ingredient twice in order, and a past date", async () => {
    const beans = await ingredient(1000, 100, "g");
    const { restocks } = await recordRestocks(
      owner.user,
      {
        lines: [
          line(beans, "1000", 200_000, { purchasedOn: "2099-12-30" }),
          line(beans, "2000", 0, { purchasedOn: TODAY }),
        ],
      },
      { now: NOW },
    );
    // 1.000 g at 100 + 1.000 g for 200.000 → 150; + 2.000 g free → 75.
    expect(
      restocks.map((row) => [row.avgCostBefore, row.avgCostAfter]),
    ).toEqual([
      ["100.0000", "150.0000"],
      ["150.0000", "75.0000"],
    ]);
    expect(await ingredientRow(beans)).toEqual({
      stockQty: "4000.000",
      avgCost: "75.0000",
    });
    expect(
      (await restocksOf(beans)).map((row) => row.purchasedOn).sort(),
    ).toEqual(["2099-12-30", TODAY]);
  });

  it("refuses the whole save for an inactive ingredient or supplier, or a future date", async () => {
    const ok = await ingredient(100, 10);
    const off = await ingredient(100, 10);
    await updateIngredient(owner.user, off, { isActive: false });
    const closed = await supplier();
    await updateSupplier(owner.user, closed, { isActive: false });

    const refusals: [RestockLine, Record<string, unknown>][] = [
      [
        line(off, "1", 10),
        { reason: "inactive_ingredient", ingredientIds: [off] },
      ],
      [line(randomUuid(), "1", 10), { reason: "inactive_ingredient" }],
      [
        line(ok, "1", 10, { supplierId: closed }),
        { reason: "inactive_supplier", supplierIds: [closed] },
      ],
      [
        line(ok, "1", 10, { purchasedOn: "2100-01-03" }),
        { reason: "future_date", fields: ["lines.1.purchasedOn"] },
      ],
    ];
    for (const [bad, details] of refusals) {
      await expect(
        recordRestocks(
          owner.user,
          { lines: [line(ok, "5", 50), bad] },
          { now: NOW },
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details });
    }
    // The valid first line was not saved either.
    expect(await restocksOf(ok)).toEqual([]);
    expect(await ingredientRow(ok)).toEqual({
      stockQty: "100.000",
      avgCost: "10.0000",
    });
  });

  it("keeps the ledger whole under parallel restocks and payments", async () => {
    const catalog = await createCatalog();
    const beans = await ingredient(1000, 285, "g");
    const [kopi] = await getDb()
      .insert(schema.menuItems)
      .values({
        categoryId: catalog.categories.drinks.id,
        name: unique("Kopi"),
        price: 20_000,
      })
      .returning();
    await setRecipe(owner.user, kopi!.id, [{ ingredientId: beans, qty: "18" }]);
    const orders = [];
    for (let i = 0; i < 10; i++) {
      orders.push(
        await createCounterOrder(staff.user, {
          clientSession: randomBytes(16).toString("base64url"),
          idempotencyKey: randomBytes(16).toString("base64url"),
          items: [{ menuItemId: kopi!.id, quantity: 1, modifierOptionIds: [] }],
        }),
      );
    }
    const events = await Promise.all(
      orders.map(({ payment }) => signedMockPaidEvent(payment!.id)),
    );
    await Promise.all([
      ...events.map((event) =>
        handlePaymentWebhook("mock", event.body, event.headers),
      ),
      ...Array.from({ length: 10 }, () =>
        recordRestocks(staff.user, { lines: [line(beans, "100", 28_500)] }),
      ),
    ]);
    // 1.000 + 10 × 100 − 10 × 18 g; every purchase at the same Rp 285.
    expect(await ingredientRow(beans)).toEqual({
      stockQty: "1820.000",
      avgCost: "285.0000",
    });
    expect(await restocksOf(beans)).toHaveLength(10);
    expect(await stockLedgerMismatches()).toEqual([]);
  });
});

describe("who may restock", () => {
  it("is staff and the owner, not the barista", async () => {
    const milk = await ingredient(100, 10);
    await expect(
      recordRestocks(barista.user, { lines: [line(milk, "1", 10)] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getRestockOptions(barista.user)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(getRestockOptions(null)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("checks the session, the origin and the body on the route", async () => {
    const milk = await ingredient(100, 10);
    const body = {
      lines: [{ ingredientId: milk, quantity: "50", totalCost: 1000 }],
    };
    const post = (
      session: string,
      more: { origin?: null; body?: unknown } = {},
    ) =>
      restocksPost(
        request("/api/counter/restocks", {
          session,
          body: more.body ?? body,
          ...(more.origin === null && { origin: null }),
        }),
      );

    expect((await post(barista.token)).status).toBe(403);
    expect((await post(staff.token, { origin: null })).status).toBe(403);
    expect(
      (
        await post(staff.token, {
          body: { lines: [{ ...body.lines[0], quantity: "0" }] },
        })
      ).status,
    ).toBe(400);
    const created = await post(staff.token);
    expect(created.status).toBe(201);
    expect((await created.json()).data.restocks[0]).toMatchObject({
      ingredientId: milk,
      avgCostBefore: "10.0000",
      avgCostAfter: "13.3333", // (100 × 10 + 1.000) / 150
      stockQty: "150.000",
    });
    expect((await post(owner.token)).status).toBe(201);
  });

  it("lists active ingredients and suppliers for the pickers", async () => {
    const milk = await ingredient(100, 10);
    const off = await ingredient(100, 10);
    await updateIngredient(owner.user, off, { isActive: false });
    const toko = await supplier();
    const closed = await supplier();
    await updateSupplier(owner.user, closed, { isActive: false });

    const response = await optionsGet(
      request("/api/counter/restock-options", {
        method: "GET",
        session: staff.token,
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { data } = await response.json();
    const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
    expect(ids(data.ingredients)).toContain(milk);
    expect(ids(data.ingredients)).not.toContain(off);
    expect(
      data.ingredients.find((row: { id: string }) => row.id === milk),
    ).toEqual({
      id: milk,
      name: expect.any(String),
      unit: "ml",
      stockQty: "100.000",
      avgCost: "10.0000",
    });
    expect(ids(data.suppliers)).toContain(toko);
    expect(ids(data.suppliers)).not.toContain(closed);
  });
});

function randomUuid() {
  return crypto.randomUUID();
}
