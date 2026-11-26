import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeSql, getDb } from "@/db/client";
import * as schema from "@/db/schema";
import {
  ownerLogin,
  pinLogin,
  resetAuthRateLimits,
  type SessionUser,
} from "@/modules/auth/service";
import { createIngredient } from "@/modules/inventory/service";
import {
  createModifierGroup,
  createModifierOption,
  getCounterMenu,
  getOwnerMenu,
  getPublicMenu,
  getSuggestionItems,
  setItemGroups,
  setManualSoldOut,
  setRecipe,
} from "@/modules/menu/service";
import {
  createCounterOrder,
  createSelfOrder,
  orderItemsStillAvailable,
  resetOrderRateLimits,
} from "@/modules/orders/service";
import { createDevice, createUser, unique } from "./auth-fixtures";
import { createCatalog } from "./menu-fixtures";
import { stockLedgerMismatches } from "./stock-ledger";

// P2-03 (FR-IV-04, FR-CO-06): an item is sold out when a recipe ingredient
// cannot cover one serving, everywhere the menu is shown; checkout refuses an
// order the stock cannot cover (recipe + option deltas × quantity).

afterAll(() => closeSql());
beforeEach(() => {
  resetAuthRateLimits();
  resetOrderRateLimits();
});

let owner: SessionUser;
let staff: SessionUser;
let catalog: Awaited<ReturnType<typeof createCatalog>>;

beforeAll(async () => {
  const ownerRow = await createUser({ role: "owner" });
  owner = (
    await ownerLogin({
      email: ownerRow.email!,
      password: ownerRow.password,
      ip: unique("ip"),
    })
  ).user;
  const staffRow = await createUser({ role: "staff", pin: "135790" });
  const device = await createDevice();
  staff = (
    await pinLogin({
      userId: staffRow.id,
      pin: staffRow.pin,
      deviceToken: device.token,
      ip: unique("ip"),
    })
  ).user;
  catalog = await createCatalog();
});

// An ingredient with the given stock (no movement when it is zero).
async function ingredient(name: string, stock: string) {
  const { id } = await createIngredient(owner, {
    name: unique(name),
    kind: "raw",
    unit: "g",
    minStockQty: "0",
    isActive: true,
    opening: Number(stock) > 0 ? { quantity: stock, totalCost: 10_000 } : null,
  });
  return id;
}

async function item(recipe: { ingredientId: string; qty: string }[]) {
  const [row] = await getDb()
    .insert(schema.menuItems)
    .values({
      categoryId: catalog.categories.drinks.id,
      name: unique("Kopi"),
      price: 20_000,
    })
    .returning();
  await setRecipe(owner, row!.id, recipe);
  return row!;
}

function order(lines: { id: string; quantity?: number; options?: string[] }[]) {
  return createSelfOrder({
    qrToken: catalog.qr.token,
    clientSession: randomBytes(16).toString("base64url"),
    idempotencyKey: randomBytes(16).toString("base64url"),
    items: lines.map((line) => ({
      menuItemId: line.id,
      quantity: line.quantity ?? 1,
      modifierOptionIds: line.options ?? [],
    })),
  });
}

async function publicItem(id: string) {
  const menu = await getPublicMenu(catalog.qr.token);
  return menu.categories.flatMap((c) => c.items).find((i) => i.id === id)!;
}

async function counterItem(id: string) {
  const menu = await getCounterMenu(staff);
  return menu.categories.flatMap((c) => c.items).find((i) => i.id === id)!;
}

describe("one serving (FR-IV-04)", () => {
  it("hides an item whose ingredient cannot cover one serving", async () => {
    const beans = await ingredient("Biji", "17.5");
    const cups = await ingredient("Cup", "50");
    const short = await item([
      { ingredientId: beans, qty: "18" },
      { ingredientId: cups, qty: "1" },
    ]);
    const exact = await item([{ ingredientId: beans, qty: "17.5" }]);

    expect((await publicItem(short.id)).isAvailable).toBe(false);
    expect((await publicItem(exact.id)).isAvailable).toBe(true);

    const counter = await counterItem(short.id);
    expect(counter).toMatchObject({ isAvailable: false, soldOut: null });
    // Only the short ingredient is named.
    expect(counter.stockShort).toEqual([expect.stringMatching(/^Biji/)]);
    expect((await counterItem(exact.id)).stockShort).toEqual([]);

    const ownerMenu = await getOwnerMenu(owner);
    expect(ownerMenu.items.find((i) => i.id === short.id)).toMatchObject({
      isAvailable: false,
      soldOut: null,
      stockShort: [expect.stringMatching(/^Biji/)],
    });

    const suggestions = await getSuggestionItems();
    expect(suggestions.find((i) => i.id === short.id)?.isAvailable).toBe(false);
    expect(suggestions.find((i) => i.id === exact.id)?.isAvailable).toBe(true);
  });

  it("refuses the sold-out item at checkout as ITEM_SOLD_OUT", async () => {
    const beans = await ingredient("Biji", "0");
    const short = await item([{ ingredientId: beans, qty: "18" }]);
    await expect(order([{ id: short.id }])).rejects.toMatchObject({
      code: "ITEM_SOLD_OUT",
      details: { items: [{ menuItemId: short.id, name: short.name }] },
    });
  });

  it("keeps an item without a recipe on the manual flag only", async () => {
    expect((await publicItem(catalog.items.croissant.id)).isAvailable).toBe(
      true,
    );
  });

  it("shows both reasons when an item is also marked by hand", async () => {
    const beans = await ingredient("Biji", "0");
    const short = await item([{ ingredientId: beans, qty: "18" }]);
    await setManualSoldOut(staff, { menuItemId: short.id, soldOut: true });
    const counter = await counterItem(short.id);
    expect(counter.soldOut).toMatchObject({ byName: expect.any(String) });
    expect(counter.stockShort).toHaveLength(1);

    // Clearing the mark does not make it available: stock still decides.
    await setManualSoldOut(staff, { menuItemId: short.id, soldOut: false });
    expect(await counterItem(short.id)).toMatchObject({
      isAvailable: false,
      soldOut: null,
    });
  });
});

describe("the whole order (FR-CO-06, Schema §5.1 step 4)", () => {
  it("refuses more than the stock covers and accepts what fits", async () => {
    const beans = await ingredient("Biji", "40");
    const kopi = await item([{ ingredientId: beans, qty: "18" }]);

    await expect(order([{ id: kopi.id, quantity: 3 }])).rejects.toMatchObject({
      code: "NOT_ENOUGH_STOCK",
      details: { items: [{ menuItemId: kopi.id, name: kopi.name }] },
    });
    // The Counter gets the same check.
    await expect(
      createCounterOrder(staff, {
        clientSession: randomBytes(16).toString("base64url"),
        idempotencyKey: randomBytes(16).toString("base64url"),
        items: [{ menuItemId: kopi.id, quantity: 3, modifierOptionIds: [] }],
      }),
    ).rejects.toMatchObject({ code: "NOT_ENOUGH_STOCK" });

    const { order: created } = await order([{ id: kopi.id, quantity: 2 }]);
    expect(created.total).toBe(40_000);
    // Unpaid orders hold no stock (deducted at payment, BR-05).
    await order([{ id: kopi.id, quantity: 2 }]);
  });

  it("counts option deltas and every line that shares an ingredient", async () => {
    const beans = await ingredient("Biji", "45");
    const kopi = await item([{ ingredientId: beans, qty: "18" }]);
    const espresso = await item([{ ingredientId: beans, qty: "18" }]);
    const { id: groupId } = await createModifierGroup(owner, {
      name: unique("Shot"),
      minSelect: 0,
      maxSelect: 1,
      isActive: true,
    });
    const { id: shot } = await createModifierOption(owner, groupId, {
      name: "Extra shot",
      priceDelta: 5000,
      isDefault: false,
      isActive: true,
      ingredientDeltas: [{ ingredientId: beans, qtyDelta: "10" }],
    });
    await setItemGroups(owner, kopi.id, [groupId]);

    // 18 + 10 + 18 = 46 g > 45 g: both items use the beans.
    await expect(
      order([{ id: kopi.id, options: [shot] }, { id: espresso.id }]),
    ).rejects.toMatchObject({
      code: "NOT_ENOUGH_STOCK",
      details: {
        items: [
          { menuItemId: kopi.id, name: kopi.name },
          { menuItemId: espresso.id, name: espresso.name },
        ],
      },
    });
    // 18 + 18 = 36 g fits; so does 28 g with the shot alone.
    await order([{ id: kopi.id }, { id: espresso.id }]);
    await order([{ id: kopi.id, options: [shot] }]);
  });

  it("does not let an option's minus free stock for another line", async () => {
    const milk = await ingredient("Susu", "300");
    const oatMilk = await ingredient("Oat", "1000");
    const latte = await item([{ ingredientId: milk, qty: "150" }]);
    const americano = await item([]);
    const { id: groupId } = await createModifierGroup(owner, {
      name: unique("Susu"),
      minSelect: 0,
      maxSelect: 1,
      isActive: true,
    });
    const { id: oat } = await createModifierOption(owner, groupId, {
      name: "Susu oat",
      priceDelta: 0,
      isDefault: false,
      isActive: true,
      ingredientDeltas: [
        { ingredientId: oatMilk, qtyDelta: "150" },
        { ingredientId: milk, qtyDelta: "-150" },
      ],
    });
    await setItemGroups(owner, americano.id, [groupId]);

    await expect(
      order([
        { id: latte.id, quantity: 3 },
        { id: americano.id, options: [oat] },
      ]),
    ).rejects.toMatchObject({
      code: "NOT_ENOUGH_STOCK",
      details: { items: [{ menuItemId: latte.id, name: latte.name }] },
    });
  });

  it("revives a late payment on one serving, like the menu", async () => {
    const beans = await ingredient("Biji", "20");
    const kopi = await item([{ ingredientId: beans, qty: "18" }]);
    const { order: created } = await order([{ id: kopi.id }]);
    expect(await orderItemsStillAvailable(created.id, getDb())).toBe(true);

    await setRecipe(owner, kopi.id, [{ ingredientId: beans, qty: "21" }]);
    expect(await orderItemsStillAvailable(created.id, getDb())).toBe(false);
  });

  it("leaves the stock ledger untouched (no deduction before payment)", async () => {
    expect(await stockLedgerMismatches()).toEqual([]);
  });
});
