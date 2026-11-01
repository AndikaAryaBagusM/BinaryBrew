import { and, asc, eq, inArray } from "drizzle-orm";
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
    .select({ label: qrTokens.label })
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
