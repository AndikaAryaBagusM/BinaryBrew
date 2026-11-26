import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { type DbExecutor, getDb } from "@/db/client";
import {
  menuItemModifierGroups,
  menuItems,
  modifierGroups,
  modifierOptionIngredients,
  modifierOptions,
  recipeItems,
} from "@/db/schema";

// SQL for the owner's catalog screens O-04 and O-06 (P2-02): recipes, the
// groups an item offers, modifier groups and options. Rules live in
// service.ts.

// Serialises every write that can lower an item's cheapest price (option
// prices, group limits, attachments, item prices), so two of them cannot
// each pass the PRICE_NEGATIVE check against the other's old state. Taken
// first, before any row lock.
export async function lockPrices(db: DbExecutor) {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('menu.prices', 0))`,
  );
}

// ---- Recipes ---------------------------------------------------------------

export function selectRecipe(menuItemId: string, db: DbExecutor = getDb()) {
  return db
    .select({ ingredientId: recipeItems.ingredientId, qty: recipeItems.qty })
    .from(recipeItems)
    .where(eq(recipeItems.menuItemId, menuItemId))
    .orderBy(asc(recipeItems.ingredientId));
}

// Availability and checkout (P2-03): the recipes of the given items.
export function selectRecipes(menuItemIds: string[], db: DbExecutor = getDb()) {
  if (menuItemIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      menuItemId: recipeItems.menuItemId,
      ingredientId: recipeItems.ingredientId,
      qty: recipeItems.qty,
    })
    .from(recipeItems)
    .where(inArray(recipeItems.menuItemId, menuItemIds))
    .orderBy(asc(recipeItems.menuItemId), asc(recipeItems.ingredientId));
}

export async function replaceRecipe(
  menuItemId: string,
  lines: { ingredientId: string; qty: string }[],
  db: DbExecutor,
) {
  await db.delete(recipeItems).where(eq(recipeItems.menuItemId, menuItemId));
  if (lines.length > 0) {
    await db
      .insert(recipeItems)
      .values(lines.map((line) => ({ menuItemId, ...line })));
  }
}

// ---- Groups an item offers -------------------------------------------------

// Every linked group, active or not, in the item's order.
export async function selectItemGroupIds(
  menuItemId: string,
  db: DbExecutor = getDb(),
) {
  const rows = await db
    .select({ groupId: menuItemModifierGroups.groupId })
    .from(menuItemModifierGroups)
    .where(eq(menuItemModifierGroups.menuItemId, menuItemId))
    .orderBy(asc(menuItemModifierGroups.sortOrder));
  return rows.map((row) => row.groupId);
}

export async function replaceItemGroups(
  menuItemId: string,
  groupIds: string[],
  db: DbExecutor,
) {
  await db
    .delete(menuItemModifierGroups)
    .where(eq(menuItemModifierGroups.menuItemId, menuItemId));
  if (groupIds.length > 0) {
    await db.insert(menuItemModifierGroups).values(
      groupIds.map((groupId, sortOrder) => ({
        menuItemId,
        groupId,
        sortOrder,
      })),
    );
  }
}

// Groups by id, share-locked in id order (they must not change while an
// item is linked to them).
export function lockGroupsForShare(ids: string[], db: DbExecutor) {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({ id: modifierGroups.id, name: modifierGroups.name })
    .from(modifierGroups)
    .where(inArray(modifierGroups.id, ids))
    .orderBy(asc(modifierGroups.id))
    .for("share");
}

// ---- O-04 lists --------------------------------------------------------------

export function selectAllGroups(db: DbExecutor = getDb()) {
  return db
    .select({
      id: modifierGroups.id,
      name: modifierGroups.name,
      minSelect: modifierGroups.minSelect,
      maxSelect: modifierGroups.maxSelect,
      isActive: modifierGroups.isActive,
    })
    .from(modifierGroups)
    .orderBy(asc(modifierGroups.sortOrder), asc(modifierGroups.name));
}

export function selectAllOptions(db: DbExecutor = getDb()) {
  return db
    .select({
      id: modifierOptions.id,
      groupId: modifierOptions.groupId,
      name: modifierOptions.name,
      priceDelta: modifierOptions.priceDelta,
      isDefault: modifierOptions.isDefault,
      isActive: modifierOptions.isActive,
    })
    .from(modifierOptions)
    .orderBy(asc(modifierOptions.sortOrder), asc(modifierOptions.name));
}

export function selectOptionDeltas(
  optionIds: string[] | null,
  db: DbExecutor = getDb(),
) {
  if (optionIds?.length === 0) return Promise.resolve([]);
  return db
    .select({
      optionId: modifierOptionIngredients.optionId,
      ingredientId: modifierOptionIngredients.ingredientId,
      qtyDelta: modifierOptionIngredients.qtyDelta,
    })
    .from(modifierOptionIngredients)
    .where(
      optionIds
        ? inArray(modifierOptionIngredients.optionId, optionIds)
        : undefined,
    )
    .orderBy(asc(modifierOptionIngredients.ingredientId));
}

// Which items offer each group ("Dipakai di menu"), in menu order.
export function selectAllLinks(db: DbExecutor = getDb()) {
  return db
    .select({
      groupId: menuItemModifierGroups.groupId,
      menuItemId: menuItems.id,
      name: menuItems.name,
    })
    .from(menuItemModifierGroups)
    .innerJoin(menuItems, eq(menuItems.id, menuItemModifierGroups.menuItemId))
    .orderBy(asc(menuItems.sortOrder), asc(menuItems.name));
}

// ---- Groups ----------------------------------------------------------------

export async function lockGroupNames(db: DbExecutor) {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('modifier_groups.name', 0))`,
  );
}

export async function findGroupByName(
  name: string,
  exceptId: string | null,
  db: DbExecutor,
) {
  const [row] = await db
    .select({ id: modifierGroups.id })
    .from(modifierGroups)
    .where(
      and(
        eq(sql`lower(${modifierGroups.name})`, name.toLowerCase()),
        exceptId ? ne(modifierGroups.id, exceptId) : undefined,
      ),
    );
  return row;
}

// New groups go last.
export async function insertGroup(
  values: {
    name: string;
    minSelect: number;
    maxSelect: number;
    isActive: boolean;
  },
  db: DbExecutor,
) {
  const [row] = await db
    .insert(modifierGroups)
    .values({
      ...values,
      sortOrder: sql`(select coalesce(max(${modifierGroups.sortOrder}), 0) + 1 from ${modifierGroups})`,
    })
    .returning({ id: modifierGroups.id });
  return row!;
}

export async function lockGroup(id: string, db: DbExecutor) {
  const [row] = await db
    .select({
      id: modifierGroups.id,
      name: modifierGroups.name,
      minSelect: modifierGroups.minSelect,
      maxSelect: modifierGroups.maxSelect,
      isActive: modifierGroups.isActive,
    })
    .from(modifierGroups)
    .where(eq(modifierGroups.id, id))
    .for("update");
  return row;
}

export async function updateGroup(
  id: string,
  values: Partial<{
    name: string;
    minSelect: number;
    maxSelect: number;
    isActive: boolean;
  }>,
  db: DbExecutor,
) {
  await db.update(modifierGroups).set(values).where(eq(modifierGroups.id, id));
}

// What the group rules (MODIFIER_RULE) need, read after a write.
export async function selectGroupRuleState(groupId: string, db: DbExecutor) {
  const [row] = await db.execute<{
    is_active: boolean;
    min_select: number;
    max_select: number;
    active_options: number;
    active_defaults: number;
    linked: boolean;
  }>(sql`
    select g.is_active, g.min_select, g.max_select,
      (select count(*)::int from modifier_options o
        where o.group_id = g.id and o.is_active) as active_options,
      (select count(*)::int from modifier_options o
        where o.group_id = g.id and o.is_active and o.is_default) as active_defaults,
      exists (select 1 from menu_item_modifier_groups l
        where l.group_id = g.id) as linked
    from modifier_groups g
    where g.id = ${groupId}`);
  return row;
}

export async function selectItemIdsUsingGroup(groupId: string, db: DbExecutor) {
  const rows = await db
    .select({ id: menuItemModifierGroups.menuItemId })
    .from(menuItemModifierGroups)
    .where(eq(menuItemModifierGroups.groupId, groupId));
  return rows.map((row) => row.id);
}

export function selectItemPrices(ids: string[], db: DbExecutor) {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({ id: menuItems.id, name: menuItems.name, price: menuItems.price })
    .from(menuItems)
    .where(inArray(menuItems.id, ids))
    .orderBy(asc(menuItems.name));
}

// ---- Options ---------------------------------------------------------------

export async function findOptionByName(
  groupId: string,
  name: string,
  exceptId: string | null,
  db: DbExecutor,
) {
  const [row] = await db
    .select({ id: modifierOptions.id })
    .from(modifierOptions)
    .where(
      and(
        eq(modifierOptions.groupId, groupId),
        eq(sql`lower(${modifierOptions.name})`, name.toLowerCase()),
        exceptId ? ne(modifierOptions.id, exceptId) : undefined,
      ),
    );
  return row;
}

// New options go last in their group.
export async function insertOption(
  values: {
    groupId: string;
    name: string;
    priceDelta: number;
    isDefault: boolean;
    isActive: boolean;
  },
  db: DbExecutor,
) {
  const [row] = await db
    .insert(modifierOptions)
    .values({
      ...values,
      sortOrder: sql`(select coalesce(max(${modifierOptions.sortOrder}), 0) + 1 from ${modifierOptions} where ${modifierOptions.groupId} = ${values.groupId})`,
    })
    .returning({ id: modifierOptions.id });
  return row!;
}

// The option's group id without a lock: the caller locks the group first,
// then the option (lock order group → option).
export async function selectOptionGroupId(id: string, db: DbExecutor) {
  const [row] = await db
    .select({ groupId: modifierOptions.groupId })
    .from(modifierOptions)
    .where(eq(modifierOptions.id, id));
  return row?.groupId;
}

export async function lockOption(id: string, db: DbExecutor) {
  const [row] = await db
    .select({
      id: modifierOptions.id,
      groupId: modifierOptions.groupId,
      name: modifierOptions.name,
      priceDelta: modifierOptions.priceDelta,
      isDefault: modifierOptions.isDefault,
      isActive: modifierOptions.isActive,
    })
    .from(modifierOptions)
    .where(eq(modifierOptions.id, id))
    .for("update");
  return row;
}

export async function updateOption(
  id: string,
  values: Partial<{
    name: string;
    priceDelta: number;
    isDefault: boolean;
    isActive: boolean;
  }>,
  db: DbExecutor,
) {
  await db
    .update(modifierOptions)
    .set(values)
    .where(eq(modifierOptions.id, id));
}

// A single-choice group has one default: picking a new one clears the rest.
export async function clearOtherDefaults(
  groupId: string,
  exceptId: string,
  db: DbExecutor,
) {
  const rows = await db
    .update(modifierOptions)
    .set({ isDefault: false })
    .where(
      and(
        eq(modifierOptions.groupId, groupId),
        ne(modifierOptions.id, exceptId),
        eq(modifierOptions.isDefault, true),
      ),
    )
    .returning({ name: modifierOptions.name });
  return rows.map((row) => row.name);
}

export async function replaceOptionDeltas(
  optionId: string,
  deltas: { ingredientId: string; qtyDelta: string }[],
  db: DbExecutor,
) {
  await db
    .delete(modifierOptionIngredients)
    .where(eq(modifierOptionIngredients.optionId, optionId));
  if (deltas.length > 0) {
    await db
      .insert(modifierOptionIngredients)
      .values(deltas.map((delta) => ({ optionId, ...delta })));
  }
}
