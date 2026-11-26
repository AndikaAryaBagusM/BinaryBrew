import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PUT as itemGroupsPut } from "@/app/api/owner/menu-items/[id]/modifier-groups/route";
import { PUT as recipePut } from "@/app/api/owner/menu-items/[id]/recipe/route";
import { GET as itemGet } from "@/app/api/owner/menu-items/[id]/route";
import { POST as optionsPost } from "@/app/api/owner/modifier-groups/[id]/options/route";
import { PATCH as groupPatch } from "@/app/api/owner/modifier-groups/[id]/route";
import {
  GET as groupsGet,
  POST as groupsPost,
} from "@/app/api/owner/modifier-groups/route";
import { PATCH as optionPatch } from "@/app/api/owner/modifier-options/[id]/route";
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
  getOwnerIngredients,
  updateIngredient,
} from "@/modules/inventory/service";
import {
  createModifierGroup,
  createModifierOption,
  getOwnerItemDetails,
  getOwnerModifierGroups,
  setItemGroups,
  setRecipe,
  updateMenuItem,
  updateModifierGroup,
  updateModifierOption,
} from "@/modules/menu/service";
import {
  createSelfOrder,
  resetOrderRateLimits,
} from "@/modules/orders/service";
import { createDevice, createUser, unique } from "./auth-fixtures";
import { createCatalog } from "./menu-fixtures";

// P2-02 (FR-IV-02, FR-OW-03): recipes, the groups an item offers, modifier
// groups and options with ingredient deltas, the PRICE_NEGATIVE and
// MODIFIER_RULE guards, and the ingredient deltas copied into an order.

afterAll(() => closeSql());
beforeEach(() => {
  resetAuthRateLimits();
  resetOrderRateLimits();
});

let owner: SessionUser;
let ownerToken: string;
let staff: SessionUser;
let staffToken: string;
let catalog: Awaited<ReturnType<typeof createCatalog>>;
let beans: string;
let milk: string;
let oat: string;

beforeAll(async () => {
  const ownerRow = await createUser({ role: "owner" });
  const login = await ownerLogin({
    email: ownerRow.email!,
    password: ownerRow.password,
    ip: unique("ip"),
  });
  owner = login.user;
  ownerToken = login.token;
  const staffRow = await createUser({ role: "staff", pin: "246810" });
  const device = await createDevice();
  const staffLogin = await pinLogin({
    userId: staffRow.id,
    pin: staffRow.pin,
    deviceToken: device.token,
    ip: unique("ip"),
  });
  staff = staffLogin.user;
  staffToken = staffLogin.token;

  catalog = await createCatalog();
  const ingredient = (name: string, unit: "g" | "ml") =>
    createIngredient(owner, {
      name: unique(name),
      kind: "raw",
      unit,
      minStockQty: "0",
      isActive: true,
      opening: null,
    }).then((row) => row.id);
  beans = await ingredient("Biji kopi", "g");
  milk = await ingredient("Susu", "ml");
  oat = await ingredient("Oat", "ml");
});

const BASE = "http://localhost:3000";

function request(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "PUT";
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

// A fresh item in the test catalog, so tests do not share recipes or links.
async function newItem(price = 20_000) {
  const [item] = await getDb()
    .insert(schema.menuItems)
    .values({
      categoryId: catalog.categories.drinks.id,
      name: unique("Kopi"),
      price,
    })
    .returning();
  return item!;
}

const option = (name: string) =>
  catalog.options.find((row) => row.name === name)!;

describe("recipes (FR-IV-02, O-06)", () => {
  it("replaces the recipe, stores one quantity form and audits from/to", async () => {
    const item = await newItem();
    const first = await setRecipe(owner, item.id, [
      { ingredientId: beans, qty: "18" },
      { ingredientId: milk, qty: "150.5" },
    ]);
    expect(first).toEqual({ id: item.id, changed: true });

    const details = await getOwnerItemDetails(owner, item.id);
    expect(details.recipe).toEqual(
      [
        { ingredientId: beans, qty: "18.000" },
        { ingredientId: milk, qty: "150.500" },
      ].sort((a, b) => (a.ingredientId < b.ingredientId ? -1 : 1)),
    );
    expect(details.groupIds).toEqual([]);

    // The same lines in another order and form: nothing changes.
    expect(
      await setRecipe(owner, item.id, [
        { ingredientId: milk, qty: "150.500" },
        { ingredientId: beans, qty: "18.0" },
      ]),
    ).toEqual({ id: item.id, changed: false });

    await setRecipe(owner, item.id, [{ ingredientId: beans, qty: "20" }]);
    const row = await lastAudit("recipe.update", item.id);
    expect(row).toMatchObject({
      actorUserId: owner.userId,
      entityType: "menu_item",
      metadata: {
        name: item.name,
        to: [{ ingredientId: beans, qty: "20.000" }],
      },
    });
    expect((row!.metadata as { from: unknown[] }).from).toHaveLength(2);

    // An empty recipe is allowed: the item has no recipe.
    await setRecipe(owner, item.id, []);
    expect((await getOwnerItemDetails(owner, item.id)).recipe).toEqual([]);
  });

  it("locks the unit of an ingredient used in a recipe", async () => {
    const item = await newItem();
    const { id } = await createIngredient(owner, {
      name: unique("Cokelat"),
      kind: "raw",
      unit: "g",
      minStockQty: "0",
      isActive: true,
      opening: null,
    });
    await setRecipe(owner, item.id, [{ ingredientId: id, qty: "25" }]);
    const { ingredients } = await getOwnerIngredients(owner);
    expect(ingredients.find((i) => i.id === id)!.unitLocked).toBe(true);
    await expect(
      updateIngredient(owner, id, { unit: "ml" }),
    ).rejects.toMatchObject({ code: "UNIT_LOCKED" });
  });

  it("refuses a new line with an inactive or unknown ingredient, keeps an old one", async () => {
    const item = await newItem();
    const { id: retiring } = await createIngredient(owner, {
      name: unique("Sirup"),
      kind: "raw",
      unit: "ml",
      minStockQty: "0",
      isActive: true,
      opening: null,
    });
    await setRecipe(owner, item.id, [{ ingredientId: retiring, qty: "10" }]);
    await updateIngredient(owner, retiring, { isActive: false });

    // Already in the recipe: may stay while other lines change.
    await setRecipe(owner, item.id, [
      { ingredientId: retiring, qty: "10" },
      { ingredientId: beans, qty: "18" },
    ]);

    const other = await newItem();
    await expect(
      setRecipe(owner, other.id, [{ ingredientId: retiring, qty: "10" }]),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { reason: "unknown_ingredient", ingredientIds: [retiring] },
    });
    const missing = crypto.randomUUID();
    await expect(
      setRecipe(owner, other.id, [{ ingredientId: missing, qty: "1" }]),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await getOwnerItemDetails(owner, other.id)).recipe).toEqual([]);
  });

  it("is for the owner only and 404s for an unknown item", async () => {
    const item = await newItem();
    await expect(
      setRecipe(staff, item.id, [{ ingredientId: beans, qty: "1" }]),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getOwnerItemDetails(staff, item.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      setRecipe(owner, crypto.randomUUID(), []),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getOwnerItemDetails(owner, "nope")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("the groups an item offers (O-06 Pilihan)", () => {
  it("saves the order, audits by name and changes nothing on a repeat", async () => {
    const item = await newItem();
    const ids = [catalog.groups.extras.id, catalog.groups.size.id];
    expect(await setItemGroups(owner, item.id, ids)).toEqual({
      id: item.id,
      changed: true,
    });
    expect((await getOwnerItemDetails(owner, item.id)).groupIds).toEqual(ids);
    expect(await setItemGroups(owner, item.id, ids)).toMatchObject({
      changed: false,
    });
    expect(await lastAudit("menu_item.groups_update", item.id)).toMatchObject({
      metadata: {
        from: [],
        to: [catalog.groups.extras.name, catalog.groups.size.name],
      },
    });

    // The public menu follows the item's order.
    await setItemGroups(owner, item.id, [...ids].reverse());
    expect((await getOwnerItemDetails(owner, item.id)).groupIds).toEqual([
      catalog.groups.size.id,
      catalog.groups.extras.id,
    ]);
  });

  it("refuses an unknown group", async () => {
    const item = await newItem();
    await expect(
      setItemGroups(owner, item.id, [crypto.randomUUID()]),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { reason: "unknown_group" },
    });
  });

  it("refuses a required group that has too few active options", async () => {
    const item = await newItem();
    const { id } = await createModifierGroup(owner, {
      name: unique("Suhu"),
      minSelect: 1,
      maxSelect: 1,
      isActive: true,
    });
    await expect(setItemGroups(owner, item.id, [id])).rejects.toMatchObject({
      code: "MODIFIER_RULE",
      details: { reason: "too_few_options", groupId: id },
    });
    expect((await getOwnerItemDetails(owner, item.id)).groupIds).toEqual([]);
    await createModifierOption(owner, id, {
      name: "Panas",
      priceDelta: 0,
      isDefault: true,
      isActive: true,
      ingredientDeltas: [],
    });
    await setItemGroups(owner, item.id, [id]);
  });
});

describe("modifier groups and options (FR-OW-03, O-04)", () => {
  it("creates a group and refuses a name in use, ignoring case", async () => {
    const name = unique("Topping");
    const { id } = await createModifierGroup(owner, {
      name,
      minSelect: 0,
      maxSelect: 2,
      isActive: true,
    });
    expect(await lastAudit("modifier_group.create", id)).toMatchObject({
      metadata: { name, minSelect: 0, maxSelect: 2 },
    });
    await expect(
      createModifierGroup(owner, {
        name: name.toUpperCase(),
        minSelect: 0,
        maxSelect: 1,
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: "NAME_TAKEN" });
    await expect(
      updateModifierGroup(owner, catalog.groups.size.id, { name }),
    ).rejects.toMatchObject({ code: "NAME_TAKEN" });
  });

  it("checks the limits against the stored values on a partial update", async () => {
    const { id } = await createModifierGroup(owner, {
      name: unique("Sirup"),
      minSelect: 0,
      maxSelect: 2,
      isActive: true,
    });
    await expect(
      updateModifierGroup(owner, id, { minSelect: 3 }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { fields: ["minSelect"] },
    });
    expect(await updateModifierGroup(owner, id, { maxSelect: 3 })).toEqual({
      id,
      changed: ["maxSelect"],
    });
    expect(await updateModifierGroup(owner, id, { maxSelect: 3 })).toEqual({
      id,
      changed: [],
    });
  });

  it("creates options with ingredient deltas and edits them as a set", async () => {
    const { id: groupId } = await createModifierGroup(owner, {
      name: unique("Susu"),
      minSelect: 0,
      maxSelect: 1,
      isActive: true,
    });
    const { id } = await createModifierOption(owner, groupId, {
      name: "Susu oat",
      priceDelta: 6000,
      isDefault: false,
      isActive: true,
      ingredientDeltas: [
        { ingredientId: oat, qtyDelta: "150" },
        { ingredientId: milk, qtyDelta: "-150" },
      ],
    });
    // The same name in another group is fine; in this one it is not.
    await expect(
      createModifierOption(owner, groupId, {
        name: "susu OAT",
        priceDelta: 0,
        isDefault: false,
        isActive: true,
        ingredientDeltas: [],
      }),
    ).rejects.toMatchObject({ code: "NAME_TAKEN" });

    const { groups } = await getOwnerModifierGroups(owner);
    const created = groups.find((g) => g.id === groupId)!;
    expect(created.options).toEqual([
      {
        id,
        name: "Susu oat",
        priceDelta: 6000,
        isDefault: false,
        isActive: true,
        ingredientDeltas: expect.arrayContaining([
          { ingredientId: oat, qtyDelta: "150.000" },
          { ingredientId: milk, qtyDelta: "-150.000" },
        ]),
      },
    ]);
    expect(created.items).toEqual([]);

    const result = await updateModifierOption(owner, id, {
      ingredientDeltas: [{ ingredientId: oat, qtyDelta: "180" }],
    });
    expect(result.changed).toEqual(["ingredientDeltas"]);
    expect(
      await updateModifierOption(owner, id, {
        ingredientDeltas: [{ ingredientId: oat, qtyDelta: "180.000" }],
      }),
    ).toEqual({ id, changed: [] });
    expect(await lastAudit("modifier_option.update", id)).toMatchObject({
      metadata: {
        changes: {
          ingredientDeltas: {
            to: [{ ingredientId: oat, qtyDelta: "180.000" }],
          },
        },
      },
    });
  });

  it("keeps one default in a single-choice group", async () => {
    const { id: groupId } = await createModifierGroup(owner, {
      name: unique("Gelas"),
      minSelect: 1,
      maxSelect: 1,
      isActive: true,
    });
    const make = (name: string, isDefault: boolean) =>
      createModifierOption(owner, groupId, {
        name,
        priceDelta: 0,
        isDefault,
        isActive: true,
        ingredientDeltas: [],
      }).then((row) => row.id);
    const small = await make("Kecil", true);
    const big = await make("Besar", false);

    await updateModifierOption(owner, big, { isDefault: true });
    const { groups } = await getOwnerModifierGroups(owner);
    const defaults = groups
      .find((g) => g.id === groupId)!
      .options.filter((o) => o.isDefault)
      .map((o) => o.id);
    expect(defaults).toEqual([big]);
    expect(await lastAudit("modifier_option.update", big)).toMatchObject({
      metadata: { clearedDefaults: ["Kecil"] },
    });
    expect(small).toBeDefined();
  });

  it("refuses more defaults than a multi-choice group allows", async () => {
    const { id: groupId } = await createModifierGroup(owner, {
      name: unique("Saus"),
      minSelect: 0,
      maxSelect: 2,
      isActive: true,
    });
    for (const name of ["A", "B"]) {
      await createModifierOption(owner, groupId, {
        name,
        priceDelta: 0,
        isDefault: true,
        isActive: true,
        ingredientDeltas: [],
      });
    }
    await expect(
      createModifierOption(owner, groupId, {
        name: "C",
        priceDelta: 0,
        isDefault: true,
        isActive: true,
        ingredientDeltas: [],
      }),
    ).rejects.toMatchObject({
      code: "MODIFIER_RULE",
      details: { reason: "too_many_defaults" },
    });
    await expect(
      updateModifierGroup(owner, groupId, { maxSelect: 1 }),
    ).rejects.toMatchObject({ code: "MODIFIER_RULE" });
  });

  it("refuses switching off the last option of a required group in use", async () => {
    const { id: groupId } = await createModifierGroup(owner, {
      name: unique("Suhu"),
      minSelect: 1,
      maxSelect: 1,
      isActive: true,
    });
    const { id } = await createModifierOption(owner, groupId, {
      name: "Dingin",
      priceDelta: 0,
      isDefault: true,
      isActive: true,
      ingredientDeltas: [],
    });
    // Not offered by any item yet: allowed and undone.
    await updateModifierOption(owner, id, { isActive: false });
    await updateModifierOption(owner, id, { isActive: true });

    const item = await newItem();
    await setItemGroups(owner, item.id, [groupId]);
    await expect(
      updateModifierOption(owner, id, { isActive: false }),
    ).rejects.toMatchObject({
      code: "MODIFIER_RULE",
      details: { reason: "too_few_options" },
    });
    // Switching off the whole group is fine.
    await updateModifierGroup(owner, groupId, { isActive: false });
  });

  it("refuses an option ingredient that is unknown or inactive", async () => {
    await expect(
      createModifierOption(owner, catalog.groups.extras.id, {
        name: unique("Sirup"),
        priceDelta: 0,
        isDefault: false,
        isActive: true,
        ingredientDeltas: [
          { ingredientId: crypto.randomUUID(), qtyDelta: "5" },
        ],
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { reason: "unknown_ingredient" },
    });
  });

  it("is for the owner only", async () => {
    await expect(getOwnerModifierGroups(staff)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      createModifierGroup(staff, {
        name: unique("X"),
        minSelect: 0,
        maxSelect: 1,
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      updateModifierOption(staff, option("Large").id, { priceDelta: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("no item may reach a negative price (PRICE_NEGATIVE)", () => {
  async function discountGroup(item: { id: string }) {
    const { id: groupId } = await createModifierGroup(owner, {
      name: unique("Promo"),
      minSelect: 0,
      maxSelect: 1,
      isActive: true,
    });
    const { id } = await createModifierOption(owner, groupId, {
      name: "Potongan",
      priceDelta: -3000,
      isDefault: false,
      isActive: true,
      ingredientDeltas: [],
    });
    await setItemGroups(owner, item.id, [groupId]);
    return { groupId, optionId: id };
  }

  it("refuses an option discount larger than an item's price", async () => {
    const item = await newItem(5000);
    const { optionId } = await discountGroup(item);
    await expect(
      updateModifierOption(owner, optionId, { priceDelta: -6000 }),
    ).rejects.toMatchObject({
      code: "PRICE_NEGATIVE",
      details: { items: [item.name] },
    });
    await updateModifierOption(owner, optionId, { priceDelta: -5000 });
  });

  it("refuses lowering the item price below the discount", async () => {
    const item = await newItem(5000);
    await discountGroup(item);
    await expect(
      updateMenuItem(owner, item.id, { price: 2000 }),
    ).rejects.toMatchObject({ code: "PRICE_NEGATIVE" });
    expect(await updateMenuItem(owner, item.id, { price: 3000 })).toMatchObject(
      { changed: ["price"] },
    );
  });

  it("refuses attaching a group whose discount is too large", async () => {
    const item = await newItem(5000);
    const { groupId } = await discountGroup(item);
    const cheap = await newItem(1000);
    await expect(
      setItemGroups(owner, cheap.id, [groupId]),
    ).rejects.toMatchObject({ code: "PRICE_NEGATIVE" });
  });

  it("checks again when a group allows more discounts", async () => {
    const item = await newItem(5000);
    const { groupId } = await discountGroup(item);
    await createModifierOption(owner, groupId, {
      name: "Potongan 2",
      priceDelta: -2500,
      isDefault: false,
      isActive: true,
      ingredientDeltas: [],
    });
    await expect(
      updateModifierGroup(owner, groupId, { maxSelect: 2 }),
    ).rejects.toMatchObject({ code: "PRICE_NEGATIVE" });
  });
});

describe("order snapshot (P2-02 acceptance)", () => {
  it("copies the extra shot's 9 g of beans into the order", async () => {
    await updateModifierOption(owner, option("Extra shot").id, {
      ingredientDeltas: [{ ingredientId: beans, qtyDelta: "9" }],
    });
    const { order } = await createSelfOrder({
      qrToken: catalog.qr.token,
      clientSession: randomBytes(16).toString("base64url"),
      idempotencyKey: randomBytes(16).toString("base64url"),
      items: [
        {
          menuItemId: catalog.items.latte.id,
          quantity: 2,
          modifierOptionIds: [option("Regular").id, option("Extra shot").id],
        },
      ],
    });
    const rows = await getDb()
      .select({
        option: schema.orderItemModifiers.optionNameSnapshot,
        deltas: schema.orderItemModifiers.ingredientDeltas,
      })
      .from(schema.orderItemModifiers)
      .innerJoin(
        schema.orderItems,
        eq(schema.orderItems.id, schema.orderItemModifiers.orderItemId),
      )
      .where(eq(schema.orderItems.orderId, order.id))
      .orderBy(schema.orderItemModifiers.position);
    expect(rows).toEqual([
      { option: "Regular", deltas: [] },
      {
        option: "Extra shot",
        deltas: [{ ingredientId: beans, qtyDelta: "9.000" }],
      },
    ]);

    // A later edit does not change the snapshot.
    await updateModifierOption(owner, option("Extra shot").id, {
      ingredientDeltas: [{ ingredientId: beans, qtyDelta: "10" }],
    });
    const [after] = await getDb()
      .select({ deltas: schema.orderItemModifiers.ingredientDeltas })
      .from(schema.orderItemModifiers)
      .innerJoin(
        schema.orderItems,
        eq(schema.orderItems.id, schema.orderItemModifiers.orderItemId),
      )
      .where(
        and(
          eq(schema.orderItems.orderId, order.id),
          eq(schema.orderItemModifiers.optionNameSnapshot, "Extra shot"),
        ),
      );
    expect(after!.deltas).toEqual([{ ingredientId: beans, qtyDelta: "9.000" }]);
  });
});

describe("routes", () => {
  it("GET /api/owner/modifier-groups needs the owner", async () => {
    expect(
      (
        await groupsGet(
          request("/api/owner/modifier-groups", { method: "GET" }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await groupsGet(
          request("/api/owner/modifier-groups", {
            method: "GET",
            session: staffToken,
          }),
        )
      ).status,
    ).toBe(403);
    const ok = await groupsGet(
      request("/api/owner/modifier-groups", {
        method: "GET",
        session: ownerToken,
      }),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const { data } = await ok.json();
    expect(
      data.groups.find((g: { id: string }) => g.id === catalog.groups.size.id)
        .items,
    ).toContainEqual({
      id: catalog.items.latte.id,
      name: catalog.items.latte.name,
    });
  });

  it("GET and PUT the recipe and the groups of an item", async () => {
    const item = await newItem();
    const put = await recipePut(
      request(`/api/owner/menu-items/${item.id}/recipe`, {
        method: "PUT",
        session: ownerToken,
        body: { lines: [{ ingredientId: beans, qty: "18" }] },
      }),
      params({ id: item.id }),
    );
    expect(put.status).toBe(200);
    expect((await put.json()).data).toEqual({ id: item.id, changed: true });

    const groups = await itemGroupsPut(
      request(`/api/owner/menu-items/${item.id}/modifier-groups`, {
        method: "PUT",
        session: ownerToken,
        body: { groupIds: [catalog.groups.size.id] },
      }),
      params({ id: item.id }),
    );
    expect(groups.status).toBe(200);

    const get = await itemGet(
      request(`/api/owner/menu-items/${item.id}`, {
        method: "GET",
        session: ownerToken,
      }),
      params({ id: item.id }),
    );
    expect((await get.json()).data).toEqual({
      id: item.id,
      recipe: [{ ingredientId: beans, qty: "18.000" }],
      groupIds: [catalog.groups.size.id],
    });
  });

  it("refuses a bad recipe body, a foreign origin and staff", async () => {
    const item = await newItem();
    const path = `/api/owner/menu-items/${item.id}/recipe`;
    const bad = await recipePut(
      request(path, {
        method: "PUT",
        session: ownerToken,
        body: { lines: [{ ingredientId: beans, qty: "0" }] },
      }),
      params({ id: item.id }),
    );
    expect(bad.status).toBe(400);
    const foreign = await recipePut(
      request(path, {
        method: "PUT",
        session: ownerToken,
        origin: "http://evil.example",
        body: { lines: [] },
      }),
      params({ id: item.id }),
    );
    expect(foreign.status).toBe(403);
    const asStaff = await recipePut(
      request(path, {
        method: "PUT",
        session: staffToken,
        body: { lines: [] },
      }),
      params({ id: item.id }),
    );
    expect(asStaff.status).toBe(403);
  });

  it("creates and edits groups and options, with the 409 messages", async () => {
    const created = await groupsPost(
      request("/api/owner/modifier-groups", {
        session: ownerToken,
        body: { name: unique("Topping"), maxSelect: 2 },
      }),
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()).data;

    const option = await optionsPost(
      request(`/api/owner/modifier-groups/${id}/options`, {
        session: ownerToken,
        body: { name: "Boba", priceDelta: 4000 },
      }),
      params({ id }),
    );
    expect(option.status).toBe(201);
    const optionId = (await option.json()).data.id;

    const item = await newItem(3000);
    await setItemGroups(owner, item.id, [id]);
    const negative = await optionPatch(
      request(`/api/owner/modifier-options/${optionId}`, {
        method: "PATCH",
        session: ownerToken,
        body: { priceDelta: -4000 },
      }),
      params({ id: optionId }),
    );
    expect(negative.status).toBe(409);
    const { error } = await negative.json();
    expect(error.code).toBe("PRICE_NEGATIVE");
    expect(error.message).toContain(item.name);

    const limits = await groupPatch(
      request(`/api/owner/modifier-groups/${id}`, {
        method: "PATCH",
        session: ownerToken,
        body: { minSelect: 1, maxSelect: 1 },
      }),
      params({ id }),
    );
    expect(limits.status).toBe(200);
    const empty = await groupPatch(
      request(`/api/owner/modifier-groups/${id}`, {
        method: "PATCH",
        session: ownerToken,
        body: {},
      }),
      params({ id }),
    );
    expect(empty.status).toBe(400);
  });
});
