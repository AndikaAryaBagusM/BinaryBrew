import { and, desc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PATCH as ingredientPatch } from "@/app/api/owner/ingredients/[id]/route";
import {
  GET as ingredientsGet,
  POST as ingredientsPost,
} from "@/app/api/owner/ingredients/route";
import { PATCH as supplierPatch } from "@/app/api/owner/suppliers/[id]/route";
import { POST as suppliersPost } from "@/app/api/owner/suppliers/route";
import { closeSql, getDb, getSql } from "@/db/client";
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
  getOwnerIngredients,
  type IngredientInput,
  updateIngredient,
  updateSupplier,
} from "@/modules/inventory/service";
import { createDevice, createUser, unique } from "./auth-fixtures";
import { createCatalog } from "./menu-fixtures";
import { stockLedgerMismatches } from "./stock-ledger";

// P2-01 (FR-IV-01): ingredients with opening stock, suppliers, owner only.
// Opening stock writes the ingredient and its ledger row together, so
// stock_qty always equals the sum of the movements (Schema §4 I7).

afterAll(() => closeSql());
beforeEach(() => resetAuthRateLimits());

let owner: SessionUser;
let ownerToken: string;
let staff: SessionUser;
let staffToken: string;
beforeAll(async () => {
  const ownerRow = await createUser({ role: "owner" });
  const login = await ownerLogin({
    email: ownerRow.email!,
    password: ownerRow.password,
    ip: unique("ip"),
  });
  owner = login.user;
  ownerToken = login.token;
  const staffRow = await createUser({ role: "staff", pin: "135790" });
  const device = await createDevice();
  const staffLogin = await pinLogin({
    userId: staffRow.id,
    pin: staffRow.pin,
    deviceToken: device.token,
    ip: unique("ip"),
  });
  staff = staffLogin.user;
  staffToken = staffLogin.token;
});

const BASE = "http://localhost:3000";

function request(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH";
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

const params = <T>(value: T) => ({ params: Promise.resolve(value) });

const input = (overrides: Partial<IngredientInput> = {}): IngredientInput => ({
  name: unique("Biji kopi"),
  kind: "raw",
  unit: "g",
  minStockQty: "1000",
  isActive: true,
  opening: null,
  ...overrides,
});

async function ingredientRow(id: string) {
  const [row] = await getDb()
    .select()
    .from(schema.ingredients)
    .where(eq(schema.ingredients.id, id));
  return row!;
}

async function movementsOf(id: string) {
  return getDb()
    .select({
      type: schema.stockMovements.type,
      qtyDelta: schema.stockMovements.qtyDelta,
      createdBy: schema.stockMovements.createdBy,
    })
    .from(schema.stockMovements)
    .where(eq(schema.stockMovements.ingredientId, id));
}

async function lastAudit(action: string, entityId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.action, action),
        eq(schema.auditLogs.entityId, entityId),
      ),
    )
    .orderBy(desc(schema.auditLogs.id))
    .limit(1);
  return row;
}

describe("ingredients (FR-IV-01)", () => {
  it("opening stock writes the ingredient, one opening movement and the cost (I7)", async () => {
    const { id } = await createIngredient(
      owner,
      input({
        minStockQty: "1000",
        opening: { quantity: "3250", totalCost: 926_250 },
      }),
    );
    expect(await ingredientRow(id)).toMatchObject({
      unit: "g",
      stockQty: "3250.000",
      minStockQty: "1000.000",
      avgCost: "285.0000",
    });
    expect(await movementsOf(id)).toEqual([
      { type: "opening", qtyDelta: "3250.000", createdBy: owner.userId },
    ]);
    expect(await stockLedgerMismatches()).toEqual([]);

    const audit = await lastAudit("ingredient.create", id);
    expect(audit?.actorUserId).toBe(owner.userId);
    expect(audit?.metadata).toMatchObject({
      unit: "g",
      opening: {
        quantity: "3250.000",
        totalCost: 926_250,
        avgCost: "285.0000",
      },
    });
  });

  it("without opening stock: zero stock, no cost, no movement", async () => {
    const { id } = await createIngredient(owner, input({ unit: "pcs" }));
    expect(await ingredientRow(id)).toMatchObject({
      stockQty: "0.000",
      avgCost: "0.0000",
    });
    expect(await movementsOf(id)).toEqual([]);
    expect(await stockLedgerMismatches()).toEqual([]);
  });

  it("keeps decimals exact and rounds the cost half-up to 4 places", async () => {
    const { id } = await createIngredient(
      owner,
      input({ unit: "ml", opening: { quantity: "1.5", totalCost: 100 } }),
    );
    expect(await ingredientRow(id)).toMatchObject({
      stockQty: "1.500",
      avgCost: "66.6667",
    });
  });

  it("refuses a duplicate name in any case and leaves nothing behind", async () => {
    const name = unique("Susu UHT");
    await createIngredient(owner, input({ name }));
    await expect(
      createIngredient(
        owner,
        input({
          name: name.toUpperCase(),
          opening: { quantity: "10", totalCost: 1000 },
        }),
      ),
    ).rejects.toMatchObject({ code: "NAME_TAKEN" });
    const rows = await getSql()`
      select count(*)::int as n from ingredients where lower(name) = lower(${name})`;
    expect(rows[0]!.n).toBe(1);
    expect(await stockLedgerMismatches()).toEqual([]);
  });

  it("edits name, kind, minimum and active; an unchanged edit writes nothing", async () => {
    const { id } = await createIngredient(owner, input());
    const name = unique("Croissant Butter");
    const result = await updateIngredient(owner, id, {
      name,
      kind: "resale",
      minStockQty: "5",
      isActive: false,
    });
    expect(result.changed.sort()).toEqual(
      ["isActive", "kind", "minStockQty", "name"].sort(),
    );
    expect(await ingredientRow(id)).toMatchObject({
      name,
      kind: "resale",
      minStockQty: "5.000",
      isActive: false,
    });
    expect((await lastAudit("ingredient.update", id))?.metadata).toMatchObject({
      changes: { minStockQty: { from: "1000.000", to: "5.000" } },
    });

    // "5" and "5.000" are the same minimum.
    expect(await updateIngredient(owner, id, { minStockQty: "5.000" })).toEqual(
      { id, changed: [] },
    );
  });

  it("the unit can change until stock, a recipe or a modifier uses it", async () => {
    const free = await createIngredient(owner, input({ unit: "g" }));
    expect(
      (await updateIngredient(owner, free.id, { unit: "ml" })).changed,
    ).toEqual(["unit"]);

    const stocked = await createIngredient(
      owner,
      input({ opening: { quantity: "100", totalCost: 5000 } }),
    );
    await expect(
      updateIngredient(owner, stocked.id, { unit: "ml" }),
    ).rejects.toMatchObject({ code: "UNIT_LOCKED" });
    // The same unit again is not a change, so it is fine.
    expect(
      (await updateIngredient(owner, stocked.id, { unit: "g" })).changed,
    ).toEqual([]);

    const catalog = await createCatalog();
    const inRecipe = await createIngredient(owner, input());
    await getDb().insert(schema.recipeItems).values({
      menuItemId: catalog.items.latte.id,
      ingredientId: inRecipe.id,
      qty: "18",
    });
    await expect(
      updateIngredient(owner, inRecipe.id, { unit: "pcs" }),
    ).rejects.toMatchObject({ code: "UNIT_LOCKED" });

    const { ingredients } = await getOwnerIngredients(owner);
    const locked = new Map(ingredients.map((i) => [i.id, i.unitLocked]));
    expect([
      locked.get(free.id),
      locked.get(stocked.id),
      locked.get(inRecipe.id),
    ]).toEqual([false, true, true]);
  });

  it("refuses a name taken by another ingredient; unknown ids are 404", async () => {
    const taken = await createIngredient(owner, input());
    const other = await createIngredient(owner, input());
    const takenName = (await ingredientRow(taken.id)).name;
    await expect(
      updateIngredient(owner, other.id, { name: takenName.toLowerCase() }),
    ).rejects.toMatchObject({ code: "NAME_TAKEN" });
    await expect(
      updateIngredient(owner, crypto.randomUUID(), { isActive: false }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      updateIngredient(owner, "not-a-uuid", { isActive: false }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is owner only", async () => {
    await expect(createIngredient(staff, input())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(getOwnerIngredients(null)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
});

describe("suppliers", () => {
  it("creates, renames, notes and switches off, with audit rows", async () => {
    const supplier = await createSupplier(owner, {
      name: unique("Roastery Kawan"),
      note: "Kirim tiap Senin",
      isActive: true,
    });
    const name = unique("Roastery Kawan Baru");
    const result = await updateSupplier(owner, supplier.id, {
      name,
      note: null,
      isActive: false,
    });
    expect(result.changed.sort()).toEqual(["isActive", "name", "note"]);
    const { suppliers } = await getOwnerIngredients(owner);
    expect(suppliers.find((s) => s.id === supplier.id)).toEqual({
      id: supplier.id,
      name,
      note: null,
      isActive: false,
    });
    expect(
      (await lastAudit("supplier.create", supplier.id))?.metadata,
    ).toMatchObject({ note: "Kirim tiap Senin" });
    expect(
      (await lastAudit("supplier.update", supplier.id))?.metadata,
    ).toMatchObject({ changes: { isActive: { from: true, to: false } } });
  });

  it("refuses a duplicate name in any case", async () => {
    const name = unique("Toko Susu");
    await createSupplier(owner, { name, note: null, isActive: true });
    await expect(
      createSupplier(owner, {
        name: name.toUpperCase(),
        note: null,
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: "NAME_TAKEN" });
  });
});

describe("inventory routes", () => {
  it("GET is owner only and not cached", async () => {
    const ok = await ingredientsGet(
      request("/api/owner/ingredients", { method: "GET", session: ownerToken }),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const body = (await ok.json()).data;
    expect(Array.isArray(body.ingredients)).toBe(true);
    expect(Array.isArray(body.suppliers)).toBe(true);

    const forbidden = await ingredientsGet(
      request("/api/owner/ingredients", { method: "GET", session: staffToken }),
    );
    expect(forbidden.status).toBe(403);
    const anonymous = await ingredientsGet(
      request("/api/owner/ingredients", { method: "GET" }),
    );
    expect(anonymous.status).toBe(401);
  });

  it("POST creates with opening stock; half an opening or bad values are 400", async () => {
    const name = unique("Gula aren cair");
    const created = await ingredientsPost(
      request("/api/owner/ingredients", {
        session: ownerToken,
        body: {
          name,
          unit: "ml",
          minStockQty: "1000",
          opening: { quantity: "600", totalCost: 27_000 },
        },
      }),
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()).data;
    expect(await ingredientRow(id)).toMatchObject({
      kind: "raw",
      stockQty: "600.000",
      avgCost: "45.0000",
    });

    const name2 = () => unique("x");
    for (const bad of [
      { name: name2(), unit: "kg" },
      { name: "", unit: "g" },
      { name: name2(), unit: "g", minStockQty: "-1" },
      { name: name2(), unit: "g", minStockQty: "1.2345" },
      { name: name2(), unit: "g", opening: { quantity: "10" } },
      { name: name2(), unit: "g", opening: { totalCost: 1000 } },
      { name: name2(), unit: "g", opening: { quantity: "0", totalCost: 1 } },
      { name: name2(), unit: "g", opening: { quantity: "1", totalCost: 0 } },
      { name: name2(), unit: "g", stockQty: "100" },
      { name: name2(), unit: "g", avgCost: "5" },
    ]) {
      const response = await ingredientsPost(
        request("/api/owner/ingredients", { session: ownerToken, body: bad }),
      );
      expect(response.status, JSON.stringify(bad)).toBe(400);
    }

    const staffPost = await ingredientsPost(
      request("/api/owner/ingredients", {
        session: staffToken,
        body: { name: unique("x"), unit: "g" },
      }),
    );
    expect(staffPost.status).toBe(403);
    expect(await stockLedgerMismatches()).toEqual([]);
  });

  it("PATCH: stock cannot be set, a locked unit is 409, another origin is 403", async () => {
    const { id } = await createIngredient(
      owner,
      input({ opening: { quantity: "10", totalCost: 1000 } }),
    );
    const patch = (body: unknown, origin?: string) =>
      ingredientPatch(
        request(`/api/owner/ingredients/${id}`, {
          method: "PATCH",
          session: ownerToken,
          body,
          origin,
        }),
        params({ id }),
      );
    expect((await patch({ stockQty: "500" })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    const locked = await patch({ unit: "ml" });
    expect(locked.status).toBe(409);
    expect((await locked.json()).error.code).toBe("UNIT_LOCKED");
    expect(
      (await patch({ isActive: false }, "https://evil.example")).status,
    ).toBe(403);
    const ok = await patch({ minStockQty: "2.5" });
    expect((await ok.json()).data.changed).toEqual(["minStockQty"]);
  });

  it("suppliers: POST creates, PATCH renames, a taken name is 409", async () => {
    const name = unique("Bakery Pagi");
    const created = await suppliersPost(
      request("/api/owner/suppliers", {
        session: ownerToken,
        body: { name, note: "" },
      }),
    );
    expect(created.status).toBe(201);
    const supplier = (await created.json()).data;
    expect(supplier).toMatchObject({ name, note: null, isActive: true });

    const taken = await suppliersPost(
      request("/api/owner/suppliers", { session: ownerToken, body: { name } }),
    );
    expect(taken.status).toBe(409);

    const renamed = await supplierPatch(
      request(`/api/owner/suppliers/${supplier.id}`, {
        method: "PATCH",
        session: ownerToken,
        body: { name: unique("Bakery Siang") },
      }),
      params({ id: supplier.id }),
    );
    expect((await renamed.json()).data.changed).toEqual(["name"]);

    const staffPatch = await supplierPatch(
      request(`/api/owner/suppliers/${supplier.id}`, {
        method: "PATCH",
        session: staffToken,
        body: { isActive: false },
      }),
      params({ id: supplier.id }),
    );
    expect(staffPatch.status).toBe(403);
  });
});
