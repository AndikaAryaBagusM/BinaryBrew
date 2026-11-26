import { and, eq, inArray } from "drizzle-orm";
import type { Db, DbExecutor } from "@/db/client";
import * as schema from "@/db/schema";
import { newQrToken } from "@/lib/ids";
import { unitCostFromTotal } from "@/lib/money";
import { fromMilli, toMilli } from "@/lib/quantity";
import { hashSecret, hashToken } from "@/modules/auth/hashing";
import * as data from "./data";

export type SeedInput = {
  ownerEmail: string;
  ownerPassword: string;
  ownerPin: string;
  staffPin: string;
  counterDeviceToken: string;
  tokenHashPepper: string;
};

// Rows created per table; all zeros on a repeat run.
export type SeedSummary = {
  settings: number;
  users: number;
  devices: number;
  categories: number;
  modifierGroups: number;
  modifierOptions: number;
  menuItems: number;
  menuItemModifierGroups: number;
  qrTokens: number;
  suppliers: number;
  ingredients: number;
  stockMovements: number;
  recipeItems: number;
  modifierOptionIngredients: number;
};

// Idempotent: every row is looked up by its natural key and created only when
// missing. Existing rows are never updated or removed, so re-running keeps
// changes the owner made. One transaction, so a failure leaves nothing behind.
export function seedDatabase(
  db: DbExecutor,
  input: SeedInput,
): Promise<SeedSummary> {
  return db.transaction(async (tx) => {
    const summary: SeedSummary = {
      settings: 0,
      users: 0,
      devices: 0,
      categories: 0,
      modifierGroups: 0,
      modifierOptions: 0,
      menuItems: 0,
      menuItemModifierGroups: 0,
      qrTokens: 0,
      suppliers: 0,
      ingredients: 0,
      stockMovements: 0,
      recipeItems: 0,
      modifierOptionIngredients: 0,
    };

    // 1. Settings (Schema §3.9)
    const settingRows = await tx
      .insert(schema.settings)
      .values(
        Object.entries(data.defaultSettings).map(([key, value]) => ({
          key,
          value,
        })),
      )
      .onConflictDoNothing()
      .returning({ key: schema.settings.key });
    summary.settings = settingRows.length;

    // 2. Users: one owner (any existing owner counts), staff by name
    let [owner] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.role, "owner"))
      .limit(1);
    if (!owner) {
      [owner] = await tx
        .insert(schema.users)
        .values({
          name: data.ownerName,
          role: "owner",
          email: input.ownerEmail,
          passwordHash: await hashSecret(input.ownerPassword),
          pinHash: await hashSecret(input.ownerPin),
        })
        .returning({ id: schema.users.id });
      summary.users++;
    }

    const existingStaff = await tx
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(inArray(schema.users.name, [...data.staffNames]));
    const staffToCreate = missing(
      data.staffNames,
      existingStaff.map((u) => u.name),
    );
    if (staffToCreate.length > 0) {
      const pinHash = await hashSecret(input.staffPin);
      await tx.insert(schema.users).values(
        staffToCreate.map((name) => ({
          name,
          role: "staff" as const,
          pinHash,
        })),
      );
      summary.users += staffToCreate.length;
    }

    // 3. Counter device; its cookie value comes from SEED_COUNTER_DEVICE_TOKEN
    const [device] = await tx
      .select({ id: schema.devices.id })
      .from(schema.devices)
      .where(eq(schema.devices.name, data.counterDeviceName))
      .limit(1);
    if (!device) {
      await tx.insert(schema.devices).values({
        name: data.counterDeviceName,
        kind: "counter",
        tokenHash: hashToken(input.counterDeviceToken, input.tokenHashPepper),
        registeredBy: owner!.id,
      });
      summary.devices++;
    }

    // 4. Categories
    const categoryRows = await tx
      .insert(schema.categories)
      .values(data.categoryNames.map((name, i) => ({ name, sortOrder: i })))
      .onConflictDoNothing()
      .returning({ id: schema.categories.id });
    summary.categories = categoryRows.length;
    const categories = await tx
      .select({ id: schema.categories.id, name: schema.categories.name })
      .from(schema.categories)
      .where(inArray(schema.categories.name, [...data.categoryNames]));
    const categoryId = new Map(categories.map((c) => [c.name, c.id]));

    // 5. Modifier groups and their options
    const existingGroups = await tx
      .select({
        id: schema.modifierGroups.id,
        name: schema.modifierGroups.name,
      })
      .from(schema.modifierGroups);
    const groupId = new Map(existingGroups.map((g) => [g.name, g.id]));
    for (const [i, group] of data.modifierGroups.entries()) {
      let id = groupId.get(group.name);
      if (!id) {
        const [created] = await tx
          .insert(schema.modifierGroups)
          .values({
            name: group.name,
            minSelect: group.minSelect,
            maxSelect: group.maxSelect,
            sortOrder: i,
          })
          .returning({ id: schema.modifierGroups.id });
        id = created!.id;
        groupId.set(group.name, id);
        summary.modifierGroups++;
      }

      const existingOptions = await tx
        .select({ name: schema.modifierOptions.name })
        .from(schema.modifierOptions)
        .where(eq(schema.modifierOptions.groupId, id));
      const optionNames = existingOptions.map((o) => o.name);
      const optionsToCreate = group.options
        .map((option, sortOrder) => ({ ...option, sortOrder }))
        .filter((option) => !optionNames.includes(option.name));
      if (optionsToCreate.length > 0) {
        await tx.insert(schema.modifierOptions).values(
          optionsToCreate.map((option) => ({
            groupId: id,
            name: option.name,
            priceDelta: option.priceDelta,
            isDefault: "isDefault" in option && option.isDefault,
            sortOrder: option.sortOrder,
          })),
        );
        summary.modifierOptions += optionsToCreate.length;
      }
    }

    // 6. Menu items and the modifier groups they offer
    const itemNames = data.menuItems.map((item) => item.name);
    const existingItems = await tx
      .select({ id: schema.menuItems.id, name: schema.menuItems.name })
      .from(schema.menuItems)
      .where(inArray(schema.menuItems.name, itemNames));
    const itemId = new Map(existingItems.map((item) => [item.name, item.id]));
    const itemsToCreate = data.menuItems
      .map((item, sortOrder) => ({ ...item, sortOrder }))
      .filter((item) => !itemId.has(item.name));
    if (itemsToCreate.length > 0) {
      const created = await tx
        .insert(schema.menuItems)
        .values(
          itemsToCreate.map((item) => ({
            categoryId: categoryId.get(item.category)!,
            name: item.name,
            description: item.description,
            price: item.price,
            isPromoted: item.isPromoted ?? false,
            sortOrder: item.sortOrder,
          })),
        )
        .returning({ id: schema.menuItems.id, name: schema.menuItems.name });
      for (const item of created) itemId.set(item.name, item.id);
      summary.menuItems = created.length;
    }

    const links = data.menuItems.flatMap((item) =>
      item.modifierGroups.map((group, sortOrder) => ({
        menuItemId: itemId.get(item.name)!,
        groupId: groupId.get(group)!,
        sortOrder,
      })),
    );
    if (links.length > 0) {
      const createdLinks = await tx
        .insert(schema.menuItemModifierGroups)
        .values(links)
        .onConflictDoNothing()
        .returning({ menuItemId: schema.menuItemModifierGroups.menuItemId });
      summary.menuItemModifierGroups = createdLinks.length;
    }

    // 7. QR tokens, by label
    const existingQr = await tx
      .select({ label: schema.qrTokens.label })
      .from(schema.qrTokens)
      .where(inArray(schema.qrTokens.label, [...data.qrLabels]));
    const qrToCreate = missing(
      data.qrLabels,
      existingQr.map((q) => q.label),
    );
    if (qrToCreate.length > 0) {
      await tx
        .insert(schema.qrTokens)
        .values(qrToCreate.map((label) => ({ label, token: newQrToken() })));
      summary.qrTokens = qrToCreate.length;
    }

    // 8. Suppliers, then ingredients with their opening stock (Schema §7
    // step 4). A new ingredient gets its opening movement in this same
    // transaction, so stock_qty equals the ledger sum (I7). Existing
    // ingredients keep whatever stock they have now.
    const supplierRows = await tx
      .insert(schema.suppliers)
      .values(data.supplierNames.map((name) => ({ name })))
      .onConflictDoNothing()
      .returning({ id: schema.suppliers.id });
    summary.suppliers = supplierRows.length;

    const existingIngredients = await tx
      .select({ name: schema.ingredients.name })
      .from(schema.ingredients)
      .where(
        inArray(
          schema.ingredients.name,
          data.ingredients.map((i) => i.name),
        ),
      );
    const ingredientsToCreate = data.ingredients.filter(
      (i) => !existingIngredients.some((row) => row.name === i.name),
    );
    if (ingredientsToCreate.length > 0) {
      const created = await tx
        .insert(schema.ingredients)
        .values(
          ingredientsToCreate.map((i) => {
            const milli = toMilli(i.openingQty);
            return {
              name: i.name,
              kind: i.kind,
              unit: i.unit,
              minStockQty: fromMilli(toMilli(i.minStockQty)),
              stockQty: fromMilli(milli),
              avgCost: unitCostFromTotal(i.openingTotalCost, milli),
            };
          }),
        )
        .returning({
          id: schema.ingredients.id,
          stockQty: schema.ingredients.stockQty,
        });
      await tx.insert(schema.stockMovements).values(
        created.map((row) => ({
          ingredientId: row.id,
          type: "opening" as const,
          qtyDelta: row.stockQty,
          createdBy: owner!.id,
        })),
      );
      summary.ingredients = created.length;
      summary.stockMovements = created.length;
    }

    // 9. Recipes and option ingredient deltas (Schema §7 step 4, P2-02),
    // only for items and options that have none yet: an owner edit is kept.
    const ingredientIds = new Map(
      (
        await tx
          .select({ id: schema.ingredients.id, name: schema.ingredients.name })
          .from(schema.ingredients)
      ).map((row) => [row.name, row.id]),
    );
    const ingredientId = (name: string) => {
      const id = ingredientIds.get(name);
      if (!id) throw new Error(`seed: unknown ingredient "${name}"`);
      return id;
    };
    const itemIds = new Map(
      (
        await tx
          .select({ id: schema.menuItems.id, name: schema.menuItems.name })
          .from(schema.menuItems)
          .where(inArray(schema.menuItems.name, itemNames))
      ).map((row) => [row.name, row.id]),
    );
    const withRecipe = new Set(
      (
        await tx
          .selectDistinct({ id: schema.recipeItems.menuItemId })
          .from(schema.recipeItems)
      ).map((row) => row.id),
    );
    const recipeRows = Object.entries(data.recipes).flatMap(([item, lines]) => {
      const menuItemId = itemIds.get(item);
      if (!menuItemId || withRecipe.has(menuItemId)) return [];
      return lines.map(([ingredient, qty]) => ({
        menuItemId,
        ingredientId: ingredientId(ingredient),
        qty: fromMilli(toMilli(qty)),
      }));
    });
    if (recipeRows.length > 0) {
      await tx.insert(schema.recipeItems).values(recipeRows);
      summary.recipeItems = recipeRows.length;
    }

    const withDeltas = new Set(
      (
        await tx
          .selectDistinct({ id: schema.modifierOptionIngredients.optionId })
          .from(schema.modifierOptionIngredients)
      ).map((row) => row.id),
    );
    const deltaRows = [];
    for (const { group, option, deltas } of data.optionDeltas) {
      const [row] = await tx
        .select({ id: schema.modifierOptions.id })
        .from(schema.modifierOptions)
        .where(
          and(
            eq(schema.modifierOptions.groupId, groupId.get(group)!),
            eq(schema.modifierOptions.name, option),
          ),
        );
      if (!row || withDeltas.has(row.id)) continue;
      deltaRows.push(
        ...deltas.map(([ingredient, qtyDelta]) => ({
          optionId: row.id,
          ingredientId: ingredientId(ingredient),
          qtyDelta: fromMilli(toMilli(qtyDelta)),
        })),
      );
    }
    if (deltaRows.length > 0) {
      await tx.insert(schema.modifierOptionIngredients).values(deltaRows);
      summary.modifierOptionIngredients = deltaRows.length;
    }

    return summary;
  });
}

function missing<T extends string>(wanted: readonly T[], existing: string[]) {
  return wanted.filter((name) => !existing.includes(name));
}

// Used by the CLI to print the QR links after seeding, in seed order.
export async function activeQrTokens(db: Db) {
  const rows = await db
    .select({ label: schema.qrTokens.label, token: schema.qrTokens.token })
    .from(schema.qrTokens)
    .where(
      and(
        eq(schema.qrTokens.isActive, true),
        inArray(schema.qrTokens.label, [...data.qrLabels]),
      ),
    );
  const order = (label: string) =>
    data.qrLabels.indexOf(label as (typeof data.qrLabels)[number]);
  return rows.sort((a, b) => order(a.label) - order(b.label));
}
