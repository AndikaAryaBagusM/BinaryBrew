import { getDb } from "@/db/client";
import { changedFields } from "@/lib/changes";
import { AppError } from "@/lib/errors";
import { unitCostFromTotal } from "@/lib/money";
import { fromMilli, toMilli } from "@/lib/quantity";
import { audit } from "@/modules/audit/service";
import { requireRole, type SessionUser } from "@/modules/auth/service";
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
