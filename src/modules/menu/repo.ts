import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { type DbExecutor, getDb } from "@/db/client";
import {
  categories,
  menuItemModifierGroups,
  menuItems,
  modifierGroups,
  modifierOptions,
  qrTokens,
} from "@/db/schema";

// SQL only; shaping and rules live in service.ts.

export async function selectActiveQr(token: string, db: DbExecutor = getDb()) {
  const [row] = await db
    .select({ id: qrTokens.id, label: qrTokens.label })
    .from(qrTokens)
    .where(and(eq(qrTokens.token, token), eq(qrTokens.isActive, true)));
  return row;
}

export function selectActiveCategories(db: DbExecutor = getDb()) {
  return db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

// Active items of active categories.
export function selectActiveItems(db: DbExecutor = getDb()) {
  return db
    .select({
      id: menuItems.id,
      categoryId: menuItems.categoryId,
      name: menuItems.name,
      description: menuItems.description,
      price: menuItems.price,
      imageUrl: menuItems.imageUrl,
      manualSoldOut: menuItems.manualSoldOut,
    })
    .from(menuItems)
    .innerJoin(categories, eq(categories.id, menuItems.categoryId))
    .where(and(eq(menuItems.isActive, true), eq(categories.isActive, true)))
    .orderBy(asc(menuItems.sortOrder), asc(menuItems.name));
}

// Active groups linked to the given items, in each item's link order.
export function selectItemGroups(itemIds: string[], db: DbExecutor = getDb()) {
  if (itemIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      menuItemId: menuItemModifierGroups.menuItemId,
      id: modifierGroups.id,
      name: modifierGroups.name,
      minSelect: modifierGroups.minSelect,
      maxSelect: modifierGroups.maxSelect,
    })
    .from(menuItemModifierGroups)
    .innerJoin(
      modifierGroups,
      eq(modifierGroups.id, menuItemModifierGroups.groupId),
    )
    .where(
      and(
        inArray(menuItemModifierGroups.menuItemId, itemIds),
        eq(modifierGroups.isActive, true),
      ),
    )
    .orderBy(
      asc(menuItemModifierGroups.sortOrder),
      asc(modifierGroups.sortOrder),
      asc(modifierGroups.name),
    );
}

export function selectActiveOptions(
  groupIds: string[],
  db: DbExecutor = getDb(),
) {
  if (groupIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      groupId: modifierOptions.groupId,
      id: modifierOptions.id,
      name: modifierOptions.name,
      priceDelta: modifierOptions.priceDelta,
      isDefault: modifierOptions.isDefault,
    })
    .from(modifierOptions)
    .where(
      and(
        inArray(modifierOptions.groupId, groupIds),
        eq(modifierOptions.isActive, true),
      ),
    )
    .orderBy(asc(modifierOptions.sortOrder), asc(modifierOptions.name));
}

// Items by id for checkout, including inactive ones (so a refusal can name
// them), with whether their category is active.
export function selectItemsForOrder(ids: string[], db: DbExecutor = getDb()) {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: menuItems.id,
      name: menuItems.name,
      price: menuItems.price,
      isActive: menuItems.isActive,
      manualSoldOut: menuItems.manualSoldOut,
      categoryActive: categories.isActive,
    })
    .from(menuItems)
    .innerJoin(categories, eq(categories.id, menuItems.categoryId))
    .where(inArray(menuItems.id, ids));
}

// S-08: an active item, locked for the sold-out toggle.
export async function lockActiveItem(id: string, db: DbExecutor) {
  const [row] = await db
    .select({ id: menuItems.id, manualSoldOut: menuItems.manualSoldOut })
    .from(menuItems)
    .where(and(eq(menuItems.id, id), eq(menuItems.isActive, true)))
    .for("update");
  return row;
}

export async function setManualSoldOut(
  id: string,
  soldOut: boolean,
  now: Date,
  db: DbExecutor,
) {
  await db
    .update(menuItems)
    .set({ manualSoldOut: soldOut, updatedAt: now })
    .where(eq(menuItems.id, id));
}

// O-03 (owner): every category and item, active or not.
export function selectAllCategories(db: DbExecutor = getDb()) {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      sortOrder: categories.sortOrder,
      isActive: categories.isActive,
    })
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

export function selectAllItems(db: DbExecutor = getDb()) {
  return db
    .select({
      id: menuItems.id,
      categoryId: menuItems.categoryId,
      name: menuItems.name,
      description: menuItems.description,
      price: menuItems.price,
      isActive: menuItems.isActive,
      isPromoted: menuItems.isPromoted,
      manualSoldOut: menuItems.manualSoldOut,
    })
    .from(menuItems)
    .innerJoin(categories, eq(categories.id, menuItems.categoryId))
    .orderBy(
      asc(categories.sortOrder),
      asc(categories.name),
      asc(menuItems.sortOrder),
      asc(menuItems.name),
    );
}

// Serialises category writes, so the case-insensitive name check cannot race.
export async function lockCategoryNames(db: DbExecutor) {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('categories.name', 0))`,
  );
}

export async function findCategoryByName(
  name: string,
  exceptId: string | null,
  db: DbExecutor,
) {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(sql`lower(${categories.name})`, name.toLowerCase()),
        exceptId ? ne(categories.id, exceptId) : undefined,
      ),
    );
  return row;
}

// New categories go last.
export async function insertCategory(name: string, db: DbExecutor) {
  const [row] = await db
    .insert(categories)
    .values({
      name,
      sortOrder: sql`(select coalesce(max(${categories.sortOrder}), 0) + 1 from ${categories})`,
    })
    .returning({
      id: categories.id,
      name: categories.name,
      isActive: categories.isActive,
    });
  return row!;
}

export async function lockCategory(id: string, db: DbExecutor) {
  const [row] = await db
    .select({
      id: categories.id,
      name: categories.name,
      isActive: categories.isActive,
    })
    .from(categories)
    .where(eq(categories.id, id))
    .for("update");
  return row;
}

export async function updateCategory(
  id: string,
  values: { name?: string; isActive?: boolean },
  db: DbExecutor,
) {
  await db.update(categories).set(values).where(eq(categories.id, id));
}

export async function categoryExists(id: string, db: DbExecutor) {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, id));
  return row !== undefined;
}

// New items go last in their category.
export async function insertMenuItem(
  values: {
    categoryId: string;
    name: string;
    description: string | null;
    price: number;
    isActive: boolean;
    isPromoted: boolean;
    now: Date;
  },
  db: DbExecutor,
) {
  const [row] = await db
    .insert(menuItems)
    .values({
      categoryId: values.categoryId,
      name: values.name,
      description: values.description,
      price: values.price,
      isActive: values.isActive,
      isPromoted: values.isPromoted,
      sortOrder: sql`(select coalesce(max(${menuItems.sortOrder}), 0) + 1 from ${menuItems} where ${menuItems.categoryId} = ${values.categoryId})`,
      createdAt: values.now,
      updatedAt: values.now,
    })
    .returning({ id: menuItems.id });
  return row!;
}

export async function lockItem(id: string, db: DbExecutor) {
  const [row] = await db
    .select({
      id: menuItems.id,
      categoryId: menuItems.categoryId,
      name: menuItems.name,
      description: menuItems.description,
      price: menuItems.price,
      isActive: menuItems.isActive,
      isPromoted: menuItems.isPromoted,
    })
    .from(menuItems)
    .where(eq(menuItems.id, id))
    .for("update");
  return row;
}

export async function updateMenuItem(
  id: string,
  values: {
    categoryId?: string;
    name?: string;
    description?: string | null;
    price?: number;
    isActive?: boolean;
    isPromoted?: boolean;
  },
  now: Date,
  db: DbExecutor,
) {
  await db
    .update(menuItems)
    .set({ ...values, updatedAt: now })
    .where(eq(menuItems.id, id));
}

// Every item, active or not, for the seed generator and the order importer.
export function selectItemCatalog(db: DbExecutor = getDb()) {
  return db
    .select({
      id: menuItems.id,
      name: menuItems.name,
      price: menuItems.price,
      isActive: menuItems.isActive,
    })
    .from(menuItems)
    .orderBy(asc(menuItems.name));
}

export function selectActiveQrCodes(db: DbExecutor = getDb()) {
  return db
    .select({ id: qrTokens.id, label: qrTokens.label })
    .from(qrTokens)
    .where(eq(qrTokens.isActive, true))
    .orderBy(asc(qrTokens.label));
}
