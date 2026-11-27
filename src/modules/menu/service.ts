import { type DbExecutor, getDb } from "@/db/client";
import { changedFields } from "@/lib/changes";
import { AppError } from "@/lib/errors";
import { fromMilli, toMilli } from "@/lib/quantity";
import { audit, latestAuditByEntity } from "@/modules/audit/service";
import {
  COUNTER_ROLES,
  requireRole,
  type SessionUser,
} from "@/modules/auth/service";
import {
  getAverageCosts,
  getStockLevels,
  useIngredients,
} from "@/modules/inventory/service";
import {
  cheapestUnitPrice,
  type PricingGroup,
  type PricingItem,
  type PricingOption,
  type PricingRates,
} from "@/modules/orders/pricing";
import { getSettings } from "@/modules/settings/service";
import * as admin from "./admin-repo";
import { type ItemCost, itemCost } from "./cost";
import * as repo from "./repo";

// Public menu for a table or entrance QR code (FR-CO-01, FR-CO-02, FR-CO-07).
// Read from the database on every call: no cache for prices or availability.

export type PublicModifierOption = {
  id: string;
  name: string;
  priceDelta: number;
  isDefault: boolean;
};

export type PublicModifierGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: PublicModifierOption[];
};

export type PublicMenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  isAvailable: boolean;
  // The owner's promote flag: the card shows "Rekomendasi" (Design §5).
  isPromoted: boolean;
  modifierGroups: PublicModifierGroup[];
};

export type PublicMenu = {
  shopName: string;
  table: string;
  // Current rates, so the cart shows the total the server will charge.
  pricing: PricingRates;
  categories: { id: string; name: string; items: PublicMenuItem[] }[];
};

// QR tokens are 128-bit base64url (lib/ids.ts); anything else is not looked up.
const QR_TOKEN = /^[A-Za-z0-9_-]{22}$/;

export async function getPublicMenu(qrToken: string): Promise<PublicMenu> {
  if (!QR_TOKEN.test(qrToken)) throw new AppError("QR_INVALID");

  const [qr, settings] = await Promise.all([
    repo.selectActiveQr(qrToken),
    getSettings([
      "shop_name",
      "ordering_enabled",
      "tax_rate_bps",
      "tax_inclusive",
      "service_charge_bps",
    ]),
  ]);
  // A rotated or unknown code (Flow E15) is reported before "closed" (E9).
  if (!qr) throw new AppError("QR_INVALID");
  if (!settings.ordering_enabled) throw new AppError("ORDERING_CLOSED");

  return {
    shopName: settings.shop_name,
    table: qr.label,
    pricing: {
      taxRateBps: settings.tax_rate_bps,
      taxInclusive: settings.tax_inclusive,
      serviceChargeBps: settings.service_charge_bps,
    },
    categories: (await loadCategories()).categories,
  };
}

// Active categories with their active items, options and availability. One
// snapshot, so an item cannot show a group that was just unlinked. Also the
// ids of the items marked sold out by hand (Counter, O-03), which the public
// menu does not show.
function loadCategories(): Promise<{
  categories: PublicMenu["categories"];
  manualSoldOut: Set<string>;
}> {
  return getDb().transaction(
    async (tx) => {
      const [categories, items] = await Promise.all([
        repo.selectActiveCategories(tx),
        repo.selectActiveItems(tx),
      ]);
      const links = await repo.selectItemGroups(
        items.map((item) => item.id),
        tx,
      );
      const options = await repo.selectActiveOptions(
        [...new Set(links.map((link) => link.id))],
        tx,
      );

      const optionsByGroup = groupBy(options, (option) => option.groupId);
      const groupsByItem = groupBy(links, (link) => link.menuItemId);
      const itemsByCategory = groupBy(items, (item) => item.categoryId);

      const shaped = categories.map((category) => ({
        id: category.id,
        name: category.name,
        items: (itemsByCategory.get(category.id) ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          price: item.price,
          imageUrl: item.imageUrl,
          isAvailable: item.isAvailable,
          isPromoted: item.isPromoted,
          modifierGroups: (groupsByItem.get(item.id) ?? []).map((group) => ({
            id: group.id,
            name: group.name,
            minSelect: group.minSelect,
            maxSelect: group.maxSelect,
            options: (optionsByGroup.get(group.id) ?? []).map((option) => ({
              id: option.id,
              name: option.name,
              priceDelta: option.priceDelta,
              isDefault: option.isDefault,
            })),
          })),
        })),
      }));
      return {
        categories: shaped,
        manualSoldOut: new Set(
          items.filter((item) => item.manualSoldOut).map((item) => item.id),
        ),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

// Counter menu (S-02, S-08, FR-POS-01, FR-POS-04): the same items and rules
// as self-order, also while self-ordering is closed (Flow E9). An item marked
// sold out by hand says who marked it and when; one sold out by stock
// (FR-IV-04) names the ingredients that cannot cover a serving.

export type SoldOutMark = { byName: string | null; at: Date | null };

export type CounterMenuItem = PublicMenuItem & {
  // The manual mark: who set it and when (both null without a record).
  soldOut: SoldOutMark | null;
  // Ingredients below one serving, sorted; empty when stock covers it.
  stockShort: string[];
};

export type CounterMenu = {
  pricing: PricingRates;
  manualPaymentNeedsOwnerPin: boolean;
  categories: { id: string; name: string; items: CounterMenuItem[] }[];
};

const SOLD_OUT_ACTIONS = ["menu_item.sold_out", "menu_item.available"] as const;

export async function getCounterMenu(
  actor: SessionUser | null,
): Promise<CounterMenu> {
  requireRole(actor, COUNTER_ROLES);
  const [settings, categories] = await Promise.all([
    getSettings([
      "tax_rate_bps",
      "tax_inclusive",
      "service_charge_bps",
      "manual_payment_requires_owner_pin",
    ]),
    loadCategories(),
  ]);
  const { categories: shaped, manualSoldOut } = categories;
  const unavailable = shaped.flatMap((category) =>
    category.items.filter((item) => !item.isAvailable).map((item) => item.id),
  );
  const [marks, short] = await Promise.all([
    latestAuditByEntity("menu_item", [...manualSoldOut], SOLD_OUT_ACTIONS),
    stockShortages(unavailable),
  ]);
  return {
    pricing: {
      taxRateBps: settings.tax_rate_bps,
      taxInclusive: settings.tax_inclusive,
      serviceChargeBps: settings.service_charge_bps,
    },
    manualPaymentNeedsOwnerPin: settings.manual_payment_requires_owner_pin,
    categories: shaped.map((category) => ({
      ...category,
      items: category.items.map((item) => ({
        ...item,
        soldOut: manualSoldOut.has(item.id)
          ? soldOutMark(marks.get(item.id))
          : null,
        stockShort: short.get(item.id) ?? [],
      })),
    })),
  };
}

function soldOutMark(
  mark: { action: string; actorName: string | null; at: Date } | undefined,
): SoldOutMark {
  return mark?.action === "menu_item.sold_out"
    ? { byName: mark.actorName, at: mark.at }
    : { byName: null, at: null };
}

// FR-IV-04: per item, the recipe ingredients whose stock is below one
// serving (why v_menu_item_availability says no), sorted by name.
async function stockShortages(
  itemIds: string[],
  db: DbExecutor = getDb(),
): Promise<Map<string, string[]>> {
  const recipes = await admin.selectRecipes(itemIds, db);
  const stock = await getStockLevels(
    recipes.map((row) => row.ingredientId),
    db,
  );
  const short = new Map<string, string[]>();
  for (const row of recipes) {
    const level = stock.get(row.ingredientId);
    if (!level || level.stockMilli >= toMilli(row.qty)) continue;
    short.set(row.menuItemId, [
      ...(short.get(row.menuItemId) ?? []),
      level.name,
    ]);
  }
  for (const names of short.values()) names.sort((a, b) => a.localeCompare(b));
  return short;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One tap on S-08 (FR-POS-04). The customer menu and checkout read the flag
// on every request, so the change shows there at once. Audited only when the
// flag actually changes.
export async function setManualSoldOut(
  actor: SessionUser | null,
  input: { menuItemId: string; soldOut: boolean },
  { now = new Date() }: { now?: Date } = {},
): Promise<{ menuItemId: string; soldOut: boolean }> {
  const user = requireRole(actor, COUNTER_ROLES);
  if (!UUID.test(input.menuItemId)) throw new AppError("NOT_FOUND");
  await getDb().transaction(async (tx) => {
    const item = await repo.lockActiveItem(input.menuItemId, tx);
    if (!item) throw new AppError("NOT_FOUND");
    if (item.manualSoldOut === input.soldOut) return;
    await repo.setManualSoldOut(item.id, input.soldOut, now, tx);
    await audit(
      {
        action: input.soldOut ? "menu_item.sold_out" : "menu_item.available",
        actor: user,
        entity: { type: "menu_item", id: item.id },
      },
      { db: tx, now },
    );
  });
  return { menuItemId: input.menuItemId, soldOut: input.soldOut };
}

// O-03 Menu management (FR-OW-02, FR-RC-05): the owner's view of every
// category and item, active or not. Items are never deleted, because order
// history points at them: "Nonaktif" hides them from customers and the
// Counter instead. Every change is audited; an update records each changed
// field with its old and new value.

export type OwnerCategory = {
  id: string;
  name: string;
  isActive: boolean;
  itemCount: number;
};

export type OwnerMenuItem = {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  price: number;
  isActive: boolean;
  isPromoted: boolean;
  // False when sold out for any reason (manual mark or stock).
  isAvailable: boolean;
  soldOut: CounterMenuItem["soldOut"];
  stockShort: string[];
  // P2-06: HPP from the current recipe and average costs (menu/cost.ts).
  cost: ItemCost;
};

export type OwnerMenu = {
  categories: OwnerCategory[];
  items: OwnerMenuItem[];
};

export async function getOwnerMenu(
  actor: SessionUser | null,
): Promise<OwnerMenu> {
  requireRole(actor, ["owner"]);
  const [categories, items] = await Promise.all([
    repo.selectAllCategories(),
    repo.selectAllItems(),
  ]);
  const [marks, short, costs] = await Promise.all([
    latestAuditByEntity(
      "menu_item",
      items.filter((item) => item.manualSoldOut).map((item) => item.id),
      SOLD_OUT_ACTIONS,
    ),
    stockShortages(items.map((item) => item.id)),
    getItemCosts(items.map((item) => item.id)),
  ]);
  const counts = groupBy(items, (item) => item.categoryId);
  return {
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      isActive: category.isActive,
      itemCount: counts.get(category.id)?.length ?? 0,
    })),
    items: items.map(({ manualSoldOut, ...item }) => ({
      ...item,
      soldOut: manualSoldOut ? soldOutMark(marks.get(item.id)) : null,
      stockShort: short.get(item.id) ?? [],
      cost: costs.get(item.id)!,
    })),
  };
}

export type MenuItemInput = {
  categoryId: string;
  name: string;
  description: string | null;
  price: number;
  isActive: boolean;
  isPromoted: boolean;
};

export async function createMenuItem(
  actor: SessionUser | null,
  input: MenuItemInput,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ id: string }> {
  const owner = requireRole(actor, ["owner"]);
  return getDb().transaction(async (tx) => {
    if (!(await repo.categoryExists(input.categoryId, tx))) {
      throw new AppError("VALIDATION_FAILED", {
        details: { fields: ["categoryId"] },
      });
    }
    const item = await repo.insertMenuItem({ ...input, now }, tx);
    await audit(
      {
        action: "menu_item.create",
        actor: owner,
        entity: { type: "menu_item", id: item.id },
        metadata: { ...input },
      },
      { db: tx, now },
    );
    return item;
  });
}

export async function updateMenuItem(
  actor: SessionUser | null,
  id: string,
  patch: Partial<MenuItemInput>,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ id: string; changed: string[] }> {
  const owner = requireRole(actor, ["owner"]);
  if (!UUID.test(id)) throw new AppError("NOT_FOUND");
  return getDb().transaction(async (tx) => {
    // A lower price can make an option mix negative (PRICE_NEGATIVE).
    if (patch.price !== undefined) await admin.lockPrices(tx);
    const item = await repo.lockItem(id, tx);
    if (!item) throw new AppError("NOT_FOUND");
    if (
      patch.categoryId !== undefined &&
      patch.categoryId !== item.categoryId &&
      !(await repo.categoryExists(patch.categoryId, tx))
    ) {
      throw new AppError("VALIDATION_FAILED", {
        details: { fields: ["categoryId"] },
      });
    }
    const changes = changedFields(item, patch);
    const changed = Object.keys(changes);
    if (changed.length === 0) return { id, changed };
    await repo.updateMenuItem(
      id,
      Object.fromEntries(changed.map((key) => [key, changes[key]!.to])),
      now,
      tx,
    );
    if (changes.price) await assertCheapestPrices([id], tx);
    await audit(
      {
        action: "menu_item.update",
        actor: owner,
        entity: { type: "menu_item", id },
        metadata: { name: item.name, changes },
      },
      { db: tx, now },
    );
    return { id, changed };
  });
}

export async function createCategory(
  actor: SessionUser | null,
  input: { name: string },
  { now = new Date() }: { now?: Date } = {},
): Promise<{ id: string; name: string; isActive: boolean }> {
  const owner = requireRole(actor, ["owner"]);
  return getDb().transaction(async (tx) => {
    await repo.lockCategoryNames(tx);
    if (await repo.findCategoryByName(input.name, null, tx)) {
      throw new AppError("NAME_TAKEN", { details: { fields: ["name"] } });
    }
    const category = await repo.insertCategory(input.name, tx);
    await audit(
      {
        action: "category.create",
        actor: owner,
        entity: { type: "category", id: category.id },
        metadata: { name: category.name },
      },
      { db: tx, now },
    );
    return category;
  });
}

// A switched-off category hides all its items from customers and the
// Counter; the items keep their own setting for when it comes back.
export async function updateCategory(
  actor: SessionUser | null,
  id: string,
  patch: { name?: string; isActive?: boolean },
  { now = new Date() }: { now?: Date } = {},
): Promise<{ id: string; changed: string[] }> {
  const owner = requireRole(actor, ["owner"]);
  if (!UUID.test(id)) throw new AppError("NOT_FOUND");
  return getDb().transaction(async (tx) => {
    await repo.lockCategoryNames(tx);
    const category = await repo.lockCategory(id, tx);
    if (!category) throw new AppError("NOT_FOUND");
    if (
      patch.name !== undefined &&
      (await repo.findCategoryByName(patch.name, id, tx))
    ) {
      throw new AppError("NAME_TAKEN", { details: { fields: ["name"] } });
    }
    const changes = changedFields(category, patch);
    const changed = Object.keys(changes);
    if (changed.length === 0) return { id, changed };
    await repo.updateCategory(
      id,
      Object.fromEntries(changed.map((key) => [key, changes[key]!.to])),
      tx,
    );
    await audit(
      {
        action: "category.update",
        actor: owner,
        entity: { type: "category", id },
        metadata: { name: category.name, changes },
      },
      { db: tx, now },
    );
    return { id, changed };
  });
}

// ---- O-06 recipe and options tab, O-04 modifier groups (P2-02) -------------
//
// FR-IV-02, FR-OW-03. Recipes and option ingredient deltas are in the
// ingredient's base unit (g, ml, pcs) as decimal strings, like the stock
// columns. Groups and options are never deleted (order snapshots keep their
// names; "Nonaktif" hides them). Lock order: the price lock, then menu items,
// groups, options, and last ingredients (inventory's useIngredients).

export type RecipeLine = { ingredientId: string; qty: string };
export type IngredientDelta = { ingredientId: string; qtyDelta: string };

export type OwnerItemDetails = {
  id: string;
  recipe: RecipeLine[];
  // The groups the item offers, active or not, in its order.
  groupIds: string[];
};

// "18" and "18.000" are the same quantity; compare and store one form.
const normalizedQty = (quantity: string) => fromMilli(toMilli(quantity));

function sameRows<T>(
  a: readonly T[],
  b: readonly T[],
  key: (row: T) => string,
) {
  return (
    a.length === b.length &&
    a.every((row, index) => key(row) === key(b[index]!))
  );
}

const byIngredient = (
  a: { ingredientId: string },
  b: { ingredientId: string },
) =>
  a.ingredientId < b.ingredientId
    ? -1
    : a.ingredientId > b.ingredientId
      ? 1
      : 0;

export async function getOwnerItemDetails(
  actor: SessionUser | null,
  id: string,
): Promise<OwnerItemDetails> {
  requireRole(actor, ["owner"]);
  if (!UUID.test(id)) throw new AppError("NOT_FOUND");
  return getDb().transaction(
    async (tx) => {
      const [item] = await admin.selectItemPrices([id], tx);
      if (!item) throw new AppError("NOT_FOUND");
      const [recipe, groupIds] = await Promise.all([
        admin.selectRecipe(id, tx),
        admin.selectItemGroupIds(id, tx),
      ]);
      return { id, recipe, groupIds };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

// "Simpan resep": replaces the whole recipe. An empty recipe means "no
// recipe" (HPP unknown, not zero; Schema §3.8). New lines need an active
// ingredient; a line whose ingredient was switched off since may stay.
export async function setRecipe(
  actor: SessionUser | null,
  id: string,
  lines: readonly RecipeLine[],
  { now = new Date() }: { now?: Date } = {},
): Promise<{ id: string; changed: boolean }> {
  const owner = requireRole(actor, ["owner"]);
  if (!UUID.test(id)) throw new AppError("NOT_FOUND");
  const next = lines
    .map((line) => ({
      ingredientId: line.ingredientId,
      qty: normalizedQty(line.qty),
    }))
    .sort(byIngredient);
  return getDb().transaction(async (tx) => {
    const item = await repo.lockItem(id, tx);
    if (!item) throw new AppError("NOT_FOUND");
    const current = (await admin.selectRecipe(id, tx)).map((line) => ({
      ingredientId: line.ingredientId,
      qty: normalizedQty(line.qty),
    }));
    const had = new Set(current.map((line) => line.ingredientId));
    await useIngredients(
      next.map((line) => line.ingredientId),
      new Set(next.map((l) => l.ingredientId).filter((i) => !had.has(i))),
      tx,
    );
    const key = (line: RecipeLine) => `${line.ingredientId}:${line.qty}`;
    if (sameRows(current, next, key)) return { id, changed: false };
    await admin.replaceRecipe(id, next, tx);
    await audit(
      {
        action: "recipe.update",
        actor: owner,
        entity: { type: "menu_item", id },
        metadata: { name: item.name, from: current, to: next },
      },
      { db: tx, now },
    );
    return { id, changed: true };
  });
}

// "Pilihan" tab: the groups the item offers, in order.
export async function setItemGroups(
  actor: SessionUser | null,
  id: string,
  groupIds: readonly string[],
  { now = new Date() }: { now?: Date } = {},
): Promise<{ id: string; changed: boolean }> {
  const owner = requireRole(actor, ["owner"]);
  if (!UUID.test(id)) throw new AppError("NOT_FOUND");
  return getDb().transaction(async (tx) => {
    await admin.lockPrices(tx);
    const item = await repo.lockItem(id, tx);
    if (!item) throw new AppError("NOT_FOUND");
    const groups = await admin.lockGroupsForShare([...groupIds], tx);
    if (groups.length !== groupIds.length) {
      throw new AppError("VALIDATION_FAILED", {
        details: { reason: "unknown_group" },
      });
    }
    const current = await admin.selectItemGroupIds(id, tx);
    if (sameRows(current, groupIds, (groupId) => groupId)) {
      return { id, changed: false };
    }
    await admin.replaceItemGroups(id, [...groupIds], tx);
    for (const groupId of groupIds) await assertGroupRules(groupId, tx);
    await assertCheapestPrices([id], tx);
    const names = new Map(
      (await admin.selectAllGroups(tx)).map((g) => [g.id, g.name]),
    );
    await audit(
      {
        action: "menu_item.groups_update",
        actor: owner,
        entity: { type: "menu_item", id },
        metadata: {
          name: item.name,
          from: current.map((groupId) => names.get(groupId)),
          to: groupIds.map((groupId) => names.get(groupId)),
        },
      },
      { db: tx, now },
    );
    return { id, changed: true };
  });
}

export type OwnerModifierOption = {
  id: string;
  name: string;
  priceDelta: number;
  isDefault: boolean;
  isActive: boolean;
  ingredientDeltas: IngredientDelta[];
};

export type OwnerModifierGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  options: OwnerModifierOption[];
  // "Dipakai di menu", in menu order.
  items: { id: string; name: string }[];
};

export async function getOwnerModifierGroups(
  actor: SessionUser | null,
): Promise<{ groups: OwnerModifierGroup[] }> {
  requireRole(actor, ["owner"]);
  return getDb().transaction(
    async (tx) => {
      const [groups, options, deltas, links] = await Promise.all([
        admin.selectAllGroups(tx),
        admin.selectAllOptions(tx),
        admin.selectOptionDeltas(null, tx),
        admin.selectAllLinks(tx),
      ]);
      const optionsByGroup = groupBy(options, (option) => option.groupId);
      const deltasByOption = groupBy(deltas, (delta) => delta.optionId);
      const linksByGroup = groupBy(links, (link) => link.groupId);
      return {
        groups: groups.map((group) => ({
          ...group,
          options: (optionsByGroup.get(group.id) ?? []).map((option) => ({
            id: option.id,
            name: option.name,
            priceDelta: option.priceDelta,
            isDefault: option.isDefault,
            isActive: option.isActive,
            ingredientDeltas: (deltasByOption.get(option.id) ?? []).map(
              ({ ingredientId, qtyDelta }) => ({ ingredientId, qtyDelta }),
            ),
          })),
          items: (linksByGroup.get(group.id) ?? []).map((link) => ({
            id: link.menuItemId,
            name: link.name,
          })),
        })),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

export type ModifierGroupInput = {
  name: string;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
};

export async function createModifierGroup(
  actor: SessionUser | null,
  input: ModifierGroupInput,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ id: string }> {
  const owner = requireRole(actor, ["owner"]);
  if (input.minSelect > input.maxSelect) {
    throw new AppError("VALIDATION_FAILED", {
      details: { fields: ["minSelect"] },
    });
  }
  return getDb().transaction(async (tx) => {
    await admin.lockGroupNames(tx);
    if (await admin.findGroupByName(input.name, null, tx)) {
      throw new AppError("NAME_TAKEN", { details: { fields: ["name"] } });
    }
    const group = await admin.insertGroup(input, tx);
    await audit(
      {
        action: "modifier_group.create",
        actor: owner,
        entity: { type: "modifier_group", id: group.id },
        metadata: { ...input },
      },
      { db: tx, now },
    );
    return group;
  });
}

export async function updateModifierGroup(
  actor: SessionUser | null,
  id: string,
  patch: Partial<ModifierGroupInput>,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ id: string; changed: string[] }> {
  const owner = requireRole(actor, ["owner"]);
  if (!UUID.test(id)) throw new AppError("NOT_FOUND");
  return getDb().transaction(async (tx) => {
    await admin.lockPrices(tx);
    if (patch.name !== undefined) await admin.lockGroupNames(tx);
    const group = await admin.lockGroup(id, tx);
    if (!group) throw new AppError("NOT_FOUND");
    if (
      patch.name !== undefined &&
      (await admin.findGroupByName(patch.name, id, tx))
    ) {
      throw new AppError("NAME_TAKEN", { details: { fields: ["name"] } });
    }
    const current = {
      name: group.name,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      isActive: group.isActive,
    };
    if (
      (patch.minSelect ?? current.minSelect) >
      (patch.maxSelect ?? current.maxSelect)
    ) {
      throw new AppError("VALIDATION_FAILED", {
        details: { fields: ["minSelect"] },
      });
    }
    const changes = changedFields(current, patch);
    const changed = Object.keys(changes);
    if (changed.length === 0) return { id, changed };
    await admin.updateGroup(
      id,
      Object.fromEntries(changed.map((key) => [key, changes[key]!.to])),
      tx,
    );
    await assertGroupRules(id, tx);
    await assertCheapestPrices(await admin.selectItemIdsUsingGroup(id, tx), tx);
    await audit(
      {
        action: "modifier_group.update",
        actor: owner,
        entity: { type: "modifier_group", id },
        metadata: { name: group.name, changes },
      },
      { db: tx, now },
    );
    return { id, changed };
  });
}

export type ModifierOptionInput = {
  name: string;
  priceDelta: number;
  isDefault: boolean;
  isActive: boolean;
  ingredientDeltas: IngredientDelta[];
};

function normalizedDeltas(deltas: readonly IngredientDelta[]) {
  return deltas
    .map((delta) => ({
      ingredientId: delta.ingredientId,
      qtyDelta: normalizedQty(delta.qtyDelta),
    }))
    .sort(byIngredient);
}

export async function createModifierOption(
  actor: SessionUser | null,
  groupId: string,
  input: ModifierOptionInput,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ id: string }> {
  const owner = requireRole(actor, ["owner"]);
  if (!UUID.test(groupId)) throw new AppError("NOT_FOUND");
  const deltas = normalizedDeltas(input.ingredientDeltas);
  return getDb().transaction(async (tx) => {
    await admin.lockPrices(tx);
    // The group lock also serialises option names within the group.
    const group = await admin.lockGroup(groupId, tx);
    if (!group) throw new AppError("NOT_FOUND");
    if (await admin.findOptionByName(groupId, input.name, null, tx)) {
      throw new AppError("NAME_TAKEN", { details: { fields: ["name"] } });
    }
    const option = await admin.insertOption(
      {
        groupId,
        name: input.name,
        priceDelta: input.priceDelta,
        isDefault: input.isDefault,
        isActive: input.isActive,
      },
      tx,
    );
    const ids = deltas.map((delta) => delta.ingredientId);
    await useIngredients(ids, new Set(ids), tx);
    await admin.replaceOptionDeltas(option.id, deltas, tx);
    const clearedDefaults =
      input.isDefault && group.maxSelect === 1
        ? await admin.clearOtherDefaults(groupId, option.id, tx)
        : [];
    await assertGroupRules(groupId, tx);
    await assertCheapestPrices(
      await admin.selectItemIdsUsingGroup(groupId, tx),
      tx,
    );
    await audit(
      {
        action: "modifier_option.create",
        actor: owner,
        entity: { type: "modifier_option", id: option.id },
        metadata: {
          group: group.name,
          ...input,
          ingredientDeltas: deltas,
          clearedDefaults,
        },
      },
      { db: tx, now },
    );
    return option;
  });
}

export async function updateModifierOption(
  actor: SessionUser | null,
  id: string,
  patch: Partial<ModifierOptionInput>,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ id: string; changed: string[] }> {
  const owner = requireRole(actor, ["owner"]);
  if (!UUID.test(id)) throw new AppError("NOT_FOUND");
  const { ingredientDeltas, ...fields } = patch;
  return getDb().transaction(async (tx) => {
    await admin.lockPrices(tx);
    const groupId = await admin.selectOptionGroupId(id, tx);
    if (!groupId) throw new AppError("NOT_FOUND");
    const group = await admin.lockGroup(groupId, tx);
    const option = await admin.lockOption(id, tx);
    if (!group || !option) throw new AppError("NOT_FOUND");
    if (
      fields.name !== undefined &&
      (await admin.findOptionByName(groupId, fields.name, id, tx))
    ) {
      throw new AppError("NAME_TAKEN", { details: { fields: ["name"] } });
    }
    const current = {
      name: option.name,
      priceDelta: option.priceDelta,
      isDefault: option.isDefault,
      isActive: option.isActive,
    };
    const changes: Record<string, { from: unknown; to: unknown }> =
      changedFields(current, fields);

    let nextDeltas: IngredientDelta[] | null = null;
    if (ingredientDeltas !== undefined) {
      const before = normalizedDeltas(await admin.selectOptionDeltas([id], tx));
      const after = normalizedDeltas(ingredientDeltas);
      const had = new Set(before.map((delta) => delta.ingredientId));
      await useIngredients(
        after.map((delta) => delta.ingredientId),
        new Set(after.map((d) => d.ingredientId).filter((i) => !had.has(i))),
        tx,
      );
      const key = (delta: IngredientDelta) =>
        `${delta.ingredientId}:${delta.qtyDelta}`;
      if (!sameRows(before, after, key)) {
        changes.ingredientDeltas = { from: before, to: after };
        nextDeltas = after;
      }
    }
    const changed = Object.keys(changes);
    if (changed.length === 0) return { id, changed };

    const values = Object.fromEntries(
      changed
        .filter((key) => key !== "ingredientDeltas")
        .map((key) => [key, changes[key]!.to]),
    );
    if (Object.keys(values).length > 0) {
      await admin.updateOption(id, values, tx);
    }
    if (nextDeltas) await admin.replaceOptionDeltas(id, nextDeltas, tx);
    const clearedDefaults =
      changes.isDefault?.to === true && group.maxSelect === 1
        ? await admin.clearOtherDefaults(groupId, id, tx)
        : [];
    await assertGroupRules(groupId, tx);
    await assertCheapestPrices(
      await admin.selectItemIdsUsingGroup(groupId, tx),
      tx,
    );
    await audit(
      {
        action: "modifier_option.update",
        actor: owner,
        entity: { type: "modifier_option", id },
        metadata: {
          name: option.name,
          group: group.name,
          changes,
          clearedDefaults,
        },
      },
      { db: tx, now },
    );
    return { id, changed };
  });
}

// Read after the write, inside the same transaction, so a refusal rolls it
// back. A group may not have more active defaults than it allows; an active
// group that some item offers needs at least `minSelect` active options, or
// that item could not be ordered at all.
async function assertGroupRules(groupId: string, db: DbExecutor) {
  const state = await admin.selectGroupRuleState(groupId, db);
  if (!state) return;
  if (state.active_defaults > state.max_select) {
    throw new AppError("MODIFIER_RULE", {
      details: { reason: "too_many_defaults", groupId },
    });
  }
  if (
    state.is_active &&
    state.linked &&
    state.active_options < state.min_select
  ) {
    throw new AppError("MODIFIER_RULE", {
      details: { reason: "too_few_options", groupId },
    });
  }
}

// No item may reach a negative unit price with any valid option choice
// (cheapestUnitPrice). Checked after the write, for every item it touches;
// the caller holds the price lock.
async function assertCheapestPrices(itemIds: string[], db: DbExecutor) {
  if (itemIds.length === 0) return;
  const items = await admin.selectItemPrices(itemIds, db);
  const links = await repo.selectItemGroups(itemIds, db);
  const options = await repo.selectActiveOptions(
    [...new Set(links.map((link) => link.id))],
    db,
  );
  const optionsByGroup = groupBy(options, (option) => option.groupId);
  const linksByItem = groupBy(links, (link) => link.menuItemId);
  const negative = items
    .filter(
      (item) =>
        cheapestUnitPrice({
          price: item.price,
          modifierGroups: (linksByItem.get(item.id) ?? []).map((group) => ({
            minSelect: group.minSelect,
            maxSelect: group.maxSelect,
            options: optionsByGroup.get(group.id) ?? [],
          })),
        }) < 0,
    )
    .map((item) => item.name);
  if (negative.length > 0) {
    throw new AppError("PRICE_NEGATIVE", { details: { items: negative } });
  }
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(key(row));
    if (list) list.push(row);
    else map.set(key(row), [row]);
  }
  return map;
}

// Checkout (Schema §5.1 step 1): the same QR and "ordering on" rules as the
// menu. Returns the QR code's id for the order.
export async function requireOrderingQr(
  qrToken: string,
): Promise<{ qrTokenId: string }> {
  if (!QR_TOKEN.test(qrToken)) throw new AppError("QR_INVALID");
  const [qr, ordering] = await Promise.all([
    repo.selectActiveQr(qrToken),
    getSettings(["ordering_enabled"]),
  ]);
  if (!qr) throw new AppError("QR_INVALID");
  if (!ordering.ordering_enabled) throw new AppError("ORDERING_CLOSED");
  return { qrTokenId: qr.id };
}

export type OrderableItem = Omit<PricingItem, "modifierGroups"> & {
  isAvailable: boolean;
  // One serving, per ingredient (P2-03 checkout, P2-04 deduction).
  recipe: RecipeLine[];
  modifierGroups: (Omit<PricingGroup, "options"> & {
    options: (PricingOption & {
      // What the option adds to or takes from the recipe, per unit. Copied
      // into order_item_modifiers.ingredient_deltas (P2-02), so the stock
      // deduction at payment (P2-04) uses what was true at order time.
      ingredientDeltas: IngredientDelta[];
    })[];
  })[];
};

// Checkout (Schema §5.1 steps 3-4): current prices, active modifier groups and
// availability for the requested items, read inside the caller's transaction.
// Ids that do not exist are left out. `isAvailable` is one serving
// (v_menu_item_availability); the caller checks the whole order against stock
// (orders/stock.ts).
export async function getOrderableItems(
  ids: readonly string[],
  db: DbExecutor,
): Promise<OrderableItem[]> {
  const items = await repo.selectItemsForOrder([...new Set(ids)], db);
  const links = await repo.selectItemGroups(
    items.map((item) => item.id),
    db,
  );
  const options = await repo.selectActiveOptions(
    [...new Set(links.map((link) => link.id))],
    db,
  );
  const recipes = groupBy(
    await admin.selectRecipes(
      items.map((item) => item.id),
      db,
    ),
    (row) => row.menuItemId,
  );
  const ingredientDeltas = new Map<string, IngredientDelta[]>();
  for (const row of await admin.selectOptionDeltas(
    options.map((option) => option.id),
    db,
  )) {
    const list = ingredientDeltas.get(row.optionId) ?? [];
    list.push({
      ingredientId: row.ingredientId,
      qtyDelta: normalizedQty(row.qtyDelta),
    });
    ingredientDeltas.set(row.optionId, list);
  }
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    price: item.price,
    isAvailable: item.isAvailable && item.categoryActive,
    recipe: (recipes.get(item.id) ?? []).map((row) => ({
      ingredientId: row.ingredientId,
      qty: normalizedQty(row.qty),
    })),
    modifierGroups: links
      .filter((link) => link.menuItemId === item.id)
      .map((group) => ({
        id: group.id,
        name: group.name,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        options: options
          .filter((option) => option.groupId === group.id)
          .map(({ id, name, priceDelta }) => ({
            id,
            name,
            priceDelta,
            ingredientDeltas: ingredientDeltas.get(id) ?? [],
          })),
      })),
  }));
}

// Payment (P2-04): the current recipe of each given item, one serving, read
// inside the caller's transaction. Items without a recipe are left out.
export async function getRecipes(
  itemIds: readonly string[],
  db: DbExecutor,
): Promise<Map<string, RecipeLine[]>> {
  const rows = await admin.selectRecipes([...new Set(itemIds)], db);
  const recipes = new Map<string, RecipeLine[]>();
  for (const row of rows) {
    recipes.set(row.menuItemId, [
      ...(recipes.get(row.menuItemId) ?? []),
      { ingredientId: row.ingredientId, qty: normalizedQty(row.qty) },
    ]);
  }
  return recipes;
}

// HPP (P2-06, FR-HP-01; O-03, O-09 and the order-history unit_cogs): each
// given item's cost from its current recipe and average costs. Every id gets
// an entry; one without a recipe is "no_recipe" with a null HPP.
export async function getItemCosts(
  itemIds: readonly string[],
  db: DbExecutor = getDb(),
): Promise<Map<string, ItemCost>> {
  const recipes = await getRecipes(itemIds, db);
  const avgCosts = await getAverageCosts(
    [...recipes.values()].flatMap((lines) =>
      lines.map((line) => line.ingredientId),
    ),
    db,
  );
  return new Map(
    itemIds.map((id) => [id, itemCost(recipes.get(id) ?? [], avgCosts)]),
  );
}

// Order history (FR-RC-07): every menu item with its current price, active or
// not, and the active QR codes.
export function getItemCatalog(db: DbExecutor = getDb()) {
  return repo.selectItemCatalog(db);
}

export function listActiveQrCodes(db: DbExecutor = getDb()) {
  return repo.selectActiveQrCodes(db);
}

export type SuggestionItem = {
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
  isPromoted: boolean;
};

// Items a recommendation may offer (Tech §10), in menu order, with one-serving
// availability like the menu.
export async function getSuggestionItems(
  db: DbExecutor = getDb(),
): Promise<SuggestionItem[]> {
  const rows = await repo.selectSuggestionItems(db);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: row.price,
    isAvailable: row.isAvailable,
    isPromoted: row.isPromoted,
  }));
}
