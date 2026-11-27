import { type DbExecutor, getDb } from "@/db/client";
import { changedFields } from "@/lib/changes";
import { AppError } from "@/lib/errors";
import { unitCostFromTotal, weightedAverageCost } from "@/lib/money";
import { fromMilli, toMilli } from "@/lib/quantity";
import { businessDate } from "@/lib/time";
import { audit } from "@/modules/audit/service";
import { requireRole, type SessionUser } from "@/modules/auth/service";
import { logger } from "@/lib/logger";
import * as repo from "./repo";

// Ingredients and suppliers (FR-IV-01, O-05). Stock is a ledger: every
// change to `ingredients.stock_qty` comes with a `stock_movements` row in the
// same transaction, so stock_qty always equals the ledger sum (Schema §4 I7).
// Ingredients and suppliers are never deleted (the ledger and restocks keep
// pointing at them); the owner switches them off instead.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IngredientKind = "raw" | "resale";
export type IngredientUnit = "g" | "ml" | "pcs";

// Quantities and the cost are decimal strings, exactly as stored.
export type OwnerIngredient = {
  id: string;
  name: string;
  kind: IngredientKind;
  unit: IngredientUnit;
  stockQty: string;
  minStockQty: string;
  avgCost: string;
  isActive: boolean;
  // The unit is fixed once stock movements, recipes or modifiers use it.
  unitLocked: boolean;
};

export type OwnerSupplier = {
  id: string;
  name: string;
  note: string | null;
  isActive: boolean;
};

export type IngredientInput = {
  name: string;
  kind: IngredientKind;
  unit: IngredientUnit;
  minStockQty: string;
  isActive: boolean;
  // Opening stock and the total paid for it (docs/05 §3.5).
  opening: { quantity: string; totalCost: number } | null;
};

export type IngredientPatch = Partial<Omit<IngredientInput, "opening">>;

// "1000" and "1000.000" are the same quantity; compare the stored form.
const normalized = (quantity: string) => fromMilli(toMilli(quantity));

export async function getOwnerIngredients(
  actor: SessionUser | null,
): Promise<{ ingredients: OwnerIngredient[]; suppliers: OwnerSupplier[] }> {
  requireRole(actor, ["owner"]);
  const [ingredients, suppliers] = await Promise.all([
    repo.selectAllIngredients(),
    repo.selectAllSuppliers(),
  ]);
  return {
    ingredients: ingredients.map((row) => ({
      ...row,
      unit: row.unit as IngredientUnit,
    })),
    suppliers,
  };
}

export async function createIngredient(
  actor: SessionUser | null,
  input: IngredientInput,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ id: string }> {
  const owner = requireRole(actor, ["owner"]);
  const openingMilli = input.opening ? toMilli(input.opening.quantity) : 0;
  if (input.opening && openingMilli <= 0) {
    throw new AppError("VALIDATION_FAILED", {
      details: { fields: ["opening.quantity"] },
    });
  }
  const stockQty = fromMilli(openingMilli);
  const avgCost = input.opening
    ? unitCostFromTotal(input.opening.totalCost, openingMilli)
    : "0.0000";
  const minStockQty = normalized(input.minStockQty);

  return getDb().transaction(async (tx) => {
    await repo.lockIngredientNames(tx);
    if (await repo.findIngredientByName(input.name, null, tx)) {
      throw new AppError("NAME_TAKEN", { details: { fields: ["name"] } });
    }
    const { id } = await repo.insertIngredient(
      {
        name: input.name,
        kind: input.kind,
        unit: input.unit,
        minStockQty,
        isActive: input.isActive,
        stockQty,
        avgCost,
        now,
      },
      tx,
    );
    if (openingMilli > 0) {
      await repo.insertStockMovement(
        {
          ingredientId: id,
          type: "opening",
          qtyDelta: stockQty,
          note: null,
          createdBy: owner.userId,
          now,
        },
        tx,
      );
    }
    await audit(
      {
        action: "ingredient.create",
        actor: owner,
        entity: { type: "ingredient", id },
        metadata: {
          name: input.name,
          kind: input.kind,
          unit: input.unit,
          minStockQty,
          isActive: input.isActive,
          opening: input.opening
            ? {
                quantity: stockQty,
                totalCost: input.opening.totalCost,
                avgCost,
              }
            : null,
        },
      },
      { db: tx, now },
    );
    return { id };
  });
}

export async function updateIngredient(
  actor: SessionUser | null,
  id: string,
  patch: IngredientPatch,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ id: string; changed: string[] }> {
  const owner = requireRole(actor, ["owner"]);
  if (!UUID.test(id)) throw new AppError("NOT_FOUND");
  const values = {
    ...patch,
    ...(patch.minStockQty !== undefined && {
      minStockQty: normalized(patch.minStockQty),
    }),
  };
  return getDb().transaction(async (tx) => {
    if (values.name !== undefined) await repo.lockIngredientNames(tx);
    const ingredient = await repo.lockIngredient(id, tx);
    if (!ingredient) throw new AppError("NOT_FOUND");
    if (
      values.name !== undefined &&
      (await repo.findIngredientByName(values.name, id, tx))
    ) {
      throw new AppError("NAME_TAKEN", { details: { fields: ["name"] } });
    }
    const { unitLocked, ...current } = ingredient;
    const changes = changedFields(current, values);
    const changed = Object.keys(changes);
    if (changes.unit && unitLocked) {
      throw new AppError("UNIT_LOCKED", { details: { fields: ["unit"] } });
    }
    if (changed.length === 0) return { id, changed };
    await repo.updateIngredient(
      id,
      Object.fromEntries(changed.map((key) => [key, changes[key]!.to])),
      now,
      tx,
    );
    await audit(
      {
        action: "ingredient.update",
        actor: owner,
        entity: { type: "ingredient", id },
        metadata: { name: ingredient.name, changes },
      },
      { db: tx, now },
    );
    return { id, changed };
  });
}

// Recipes and modifier deltas (P2-02, menu module): checks the ingredients a
// recipe or option names, inside the caller's transaction. Every id must
// exist; ids in `newIds` (lines being added) must also be active, while a line
// that already used a since-deactivated ingredient may stay. The rows are
// share-locked, so the unit cannot change until the caller commits (lock
// order: menu rows first, then ingredients).
export async function useIngredients(
  ids: readonly string[],
  newIds: ReadonlySet<string>,
  db: DbExecutor,
): Promise<Map<string, { name: string; unit: IngredientUnit }>> {
  const unique = [...new Set(ids)];
  const rows = await repo.lockIngredientsForShare(
    unique.filter((id) => UUID.test(id)),
    db,
  );
  const found = new Map(rows.map((row) => [row.id, row]));
  const invalid = unique.filter((id) => {
    const row = found.get(id);
    return !row || (newIds.has(id) && !row.isActive);
  });
  if (invalid.length > 0) {
    throw new AppError("VALIDATION_FAILED", {
      details: { reason: "unknown_ingredient", ingredientIds: invalid },
    });
  }
  return new Map(
    rows.map((row) => [
      row.id,
      { name: row.name, unit: row.unit as IngredientUnit },
    ]),
  );
}

export async function createSupplier(
  actor: SessionUser | null,
  input: { name: string; note: string | null; isActive: boolean },
  { now = new Date() }: { now?: Date } = {},
): Promise<OwnerSupplier> {
  const owner = requireRole(actor, ["owner"]);
  return getDb().transaction(async (tx) => {
    await repo.lockSupplierNames(tx);
    if (await repo.findSupplierByName(input.name, null, tx)) {
      throw new AppError("NAME_TAKEN", { details: { fields: ["name"] } });
    }
    const supplier = await repo.insertSupplier(input, tx);
    await audit(
      {
        action: "supplier.create",
        actor: owner,
        entity: { type: "supplier", id: supplier.id },
        metadata: { ...input },
      },
      { db: tx, now },
    );
    return supplier;
  });
}

export async function updateSupplier(
  actor: SessionUser | null,
  id: string,
  patch: Partial<{ name: string; note: string | null; isActive: boolean }>,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ id: string; changed: string[] }> {
  const owner = requireRole(actor, ["owner"]);
  if (!UUID.test(id)) throw new AppError("NOT_FOUND");
  return getDb().transaction(async (tx) => {
    if (patch.name !== undefined) await repo.lockSupplierNames(tx);
    const supplier = await repo.lockSupplier(id, tx);
    if (!supplier) throw new AppError("NOT_FOUND");
    if (
      patch.name !== undefined &&
      (await repo.findSupplierByName(patch.name, id, tx))
    ) {
      throw new AppError("NAME_TAKEN", { details: { fields: ["name"] } });
    }
    const changes = changedFields(supplier, patch);
    const changed = Object.keys(changes);
    if (changed.length === 0) return { id, changed };
    await repo.updateSupplier(
      id,
      Object.fromEntries(changed.map((key) => [key, changes[key]!.to])),
      tx,
    );
    await audit(
      {
        action: "supplier.update",
        actor: owner,
        entity: { type: "supplier", id },
        metadata: { name: supplier.name, changes },
      },
      { db: tx, now },
    );
    return { id, changed };
  });
}

// Availability (P2-03, menu and orders modules): the current stock of the
// given ingredients in thousandths of their base unit, with their names.
// Plain reads: stock only changes at payment (BR-05), restock and counts,
// and checkout compares against what is there now (Schema §5.1 step 4).
export async function getStockLevels(
  ids: readonly string[],
  db: DbExecutor = getDb(),
): Promise<Map<string, { name: string; stockMilli: number }>> {
  const rows = await repo.selectStockLevels(
    [...new Set(ids)].filter((id) => UUID.test(id)),
    db,
  );
  return new Map(
    rows.map((row) => [
      row.id,
      { name: row.name, stockMilli: toMilli(row.stockQty) },
    ]),
  );
}

// Payment (P2-04, FR-IV-03, BR-05; orders module, inside the mark-paid
// transaction): takes what a paid order needs, in thousandths per ingredient,
// out of stock. One sale_deduction movement per ingredient, so stock_qty stays
// equal to the ledger (I7). Stock may go below zero: the sale already
// happened. O-05 shows it as "Minus"; it is also logged. Returns the current
// average cost of each ingredient, for the order lines' unit_cogs.
export async function deductForSale(
  input: { orderId: string; needs: ReadonlyMap<string, number>; now: Date },
  db: DbExecutor,
): Promise<Map<string, string>> {
  const wanted = [...input.needs].filter(([, milli]) => milli > 0);
  const rows = await repo.lockIngredientsForUpdate(
    wanted.map(([id]) => id).filter((id) => UUID.test(id)),
    db,
  );
  const found = new Map(rows.map((row) => [row.id, row]));
  const missing = wanted.filter(([id]) => !found.has(id)).map(([id]) => id);
  if (missing.length > 0) {
    // Ingredients are never deleted, so only a hand-edited snapshot gets here.
    logger.error(
      { orderId: input.orderId, ingredientIds: missing },
      "sale deduction skipped unknown ingredients",
    );
  }
  const deductions = rows.map((row) => ({
    ingredientId: row.id,
    qtyDelta: fromMilli(-input.needs.get(row.id)!),
  }));
  await repo.insertSaleDeductions(input.orderId, deductions, input.now, db);
  const negative = rows
    .filter((row) => toMilli(row.stockQty) - input.needs.get(row.id)! < 0)
    .map((row) => row.id);
  if (negative.length > 0) {
    logger.warn(
      { orderId: input.orderId, ingredientIds: negative },
      "stock below zero after a sale",
    );
  }
  return new Map(rows.map((row) => [row.id, row.avgCost]));
}

// --- Restock (P2-05, FR-IV-05, BR-09; S-09 and O-07) ---

export const RESTOCK_ROLES = ["owner", "staff"] as const;

export type RestockOptions = {
  ingredients: {
    id: string;
    name: string;
    unit: IngredientUnit;
    stockQty: string;
    avgCost: string;
  }[];
  suppliers: { id: string; name: string }[];
};

// What S-09 and O-07 pick from: active ingredients with their current stock
// and average cost (for the preview) and active suppliers.
export async function getRestockOptions(
  actor: SessionUser | null,
): Promise<RestockOptions> {
  requireRole(actor, RESTOCK_ROLES);
  const [ingredients, suppliers] = await Promise.all([
    repo.selectActiveIngredients(),
    repo.selectActiveSuppliers(),
  ]);
  return {
    ingredients: ingredients.map((row) => ({
      ...row,
      unit: row.unit as IngredientUnit,
    })),
    suppliers,
  };
}

export type RestockLine = {
  ingredientId: string;
  quantity: string;
  totalCost: number;
  supplierId: string | null;
  purchasedOn: string | null; // "YYYY-MM-DD"; null = today
};

export type RecordedRestock = {
  id: string;
  ingredientId: string;
  avgCostBefore: string;
  avgCostAfter: string;
  stockQty: string;
};

// Records purchases (Schema §5.5) in one transaction: per line a restocks
// row, a restock movement (stock_qty stays equal to the ledger, I7) and the
// new weighted-average cost. Lines apply in order, so an ingredient bought
// twice averages twice. Ingredients are locked in id order, then the named
// suppliers share-locked. Every ingredient and supplier must be active; the
// purchase date may not be after today in the shop's calendar.
export async function recordRestocks(
  actor: SessionUser | null,
  input: { lines: readonly RestockLine[] },
  { now = new Date() }: { now?: Date } = {},
): Promise<{ restocks: RecordedRestock[] }> {
  const user = requireRole(actor, RESTOCK_ROLES);
  const today = businessDate(now, "00:00");
  const late = input.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.purchasedOn !== null && line.purchasedOn > today)
    .map(({ index }) => `lines.${index}.purchasedOn`);
  if (late.length > 0) {
    throw new AppError("VALIDATION_FAILED", {
      details: { reason: "future_date", fields: late },
    });
  }

  return getDb().transaction(async (tx) => {
    const ingredientIds = [
      ...new Set(input.lines.map((line) => line.ingredientId)),
    ];
    const rows = await repo.lockIngredientsForRestock(ingredientIds, tx);
    const found = new Map(rows.map((row) => [row.id, row]));
    const badIngredients = ingredientIds.filter(
      (id) => !found.get(id)?.isActive,
    );
    if (badIngredients.length > 0) {
      throw new AppError("VALIDATION_FAILED", {
        details: {
          reason: "inactive_ingredient",
          ingredientIds: badIngredients,
        },
      });
    }
    const supplierIds = [
      ...new Set(
        input.lines.flatMap((line) =>
          line.supplierId ? [line.supplierId] : [],
        ),
      ),
    ];
    const suppliers = new Map(
      (await repo.lockSuppliersForShare(supplierIds, tx)).map((row) => [
        row.id,
        row,
      ]),
    );
    const badSuppliers = supplierIds.filter(
      (id) => !suppliers.get(id)?.isActive,
    );
    if (badSuppliers.length > 0) {
      throw new AppError("VALIDATION_FAILED", {
        details: { reason: "inactive_supplier", supplierIds: badSuppliers },
      });
    }

    const state = new Map(
      rows.map((row) => [
        row.id,
        { stockMilli: toMilli(row.stockQty), avgCost: row.avgCost },
      ]),
    );
    const recorded: RecordedRestock[] = [];
    for (const line of input.lines) {
      const ingredient = found.get(line.ingredientId)!;
      const before = state.get(line.ingredientId)!;
      const quantityMilli = toMilli(line.quantity);
      const quantity = fromMilli(quantityMilli);
      const after = {
        stockMilli: before.stockMilli + quantityMilli,
        avgCost: weightedAverageCost(before, {
          quantityMilli,
          totalCost: line.totalCost,
        }),
      };
      const purchasedOn = line.purchasedOn ?? today;
      const { id } = await repo.insertRestock(
        {
          ingredientId: line.ingredientId,
          supplierId: line.supplierId,
          quantity,
          totalCost: line.totalCost,
          purchasedOn,
          createdBy: user.userId,
          now,
        },
        tx,
      );
      await repo.insertStockMovement(
        {
          ingredientId: line.ingredientId,
          type: "restock",
          qtyDelta: quantity,
          note: null,
          refType: "restock",
          refId: id,
          createdBy: user.userId,
          now,
        },
        tx,
      );
      const stockQty = fromMilli(after.stockMilli);
      await repo.setStockAndCost(
        line.ingredientId,
        { stockQty, avgCost: after.avgCost },
        now,
        tx,
      );
      await audit(
        {
          action: "restock.create",
          actor: user,
          entity: { type: "restock", id },
          metadata: {
            ingredientId: line.ingredientId,
            name: ingredient.name,
            quantity,
            unit: ingredient.unit,
            totalCost: line.totalCost,
            supplierId: line.supplierId,
            supplier: line.supplierId
              ? suppliers.get(line.supplierId)!.name
              : null,
            purchasedOn,
            avgCost: { from: before.avgCost, to: after.avgCost },
            stockQty: { from: fromMilli(before.stockMilli), to: stockQty },
          },
        },
        { db: tx, now },
      );
      state.set(line.ingredientId, after);
      recorded.push({
        id,
        ingredientId: line.ingredientId,
        avgCostBefore: before.avgCost,
        avgCostAfter: after.avgCost,
        stockQty,
      });
    }
    return { restocks: recorded };
  });
}

// HPP (P2-06, menu module): the current weighted-average cost of the given
// ingredients, as stored ("285.0000"). Plain reads.
export async function getAverageCosts(
  ids: readonly string[],
  db: DbExecutor = getDb(),
): Promise<Map<string, string>> {
  const rows = await repo.selectAverageCosts(
    [...new Set(ids)].filter((id) => UUID.test(id)),
    db,
  );
  return new Map(rows.map((row) => [row.id, row.avgCost]));
}
