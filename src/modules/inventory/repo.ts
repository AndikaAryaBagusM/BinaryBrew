import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { type DbExecutor, getDb } from "@/db/client";
import { ingredients, restocks, stockMovements, suppliers } from "@/db/schema";

// SQL only; shaping and rules live in service.ts.

export type IngredientRow = {
  id: string;
  name: string;
  kind: "raw" | "resale";
  unit: string;
  stockQty: string;
  avgCost: string;
  minStockQty: string;
  isActive: boolean;
};

const ingredientColumns = {
  id: ingredients.id,
  name: ingredients.name,
  kind: ingredients.kind,
  unit: ingredients.unit,
  stockQty: ingredients.stockQty,
  avgCost: ingredients.avgCost,
  minStockQty: ingredients.minStockQty,
  isActive: ingredients.isActive,
};

// Something already counts in this ingredient's unit: a stock movement, a
// recipe line or a modifier delta. Then the unit can no longer change.
// Column names are written out: inside a subquery Drizzle leaves them
// unqualified, and "id" would bind to the inner table.
const inUse = sql<boolean>`(
  exists (select 1 from stock_movements m where m.ingredient_id = "ingredients"."id")
  or exists (select 1 from recipe_items r where r.ingredient_id = "ingredients"."id")
  or exists (select 1 from modifier_option_ingredients o where o.ingredient_id = "ingredients"."id")
)`;

export async function selectAllIngredients(db: DbExecutor = getDb()) {
  return db
    .select({ ...ingredientColumns, unitLocked: inUse })
    .from(ingredients)
    .orderBy(asc(ingredients.name));
}

// Names are unique ignoring case; this lock makes check-then-insert safe.
export async function lockIngredientNames(db: DbExecutor) {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('ingredients.name', 0))`,
  );
}

export async function findIngredientByName(
  name: string,
  exceptId: string | null,
  db: DbExecutor,
) {
  const [row] = await db
    .select({ id: ingredients.id })
    .from(ingredients)
    .where(
      and(
        eq(sql`lower(${ingredients.name})`, name.toLowerCase()),
        exceptId ? ne(ingredients.id, exceptId) : undefined,
      ),
    );
  return row;
}

export async function insertIngredient(
  values: {
    name: string;
    kind: "raw" | "resale";
    unit: string;
    minStockQty: string;
    isActive: boolean;
    stockQty: string;
    avgCost: string;
    now: Date;
  },
  db: DbExecutor,
) {
  const { now, ...row } = values;
  const [created] = await db
    .insert(ingredients)
    .values({ ...row, createdAt: now, updatedAt: now })
    .returning({ id: ingredients.id });
  return created!;
}

// Ledger row (Schema §3.5). Append-only: nothing in the app updates or
// deletes one (I8).
export async function insertStockMovement(
  values: {
    ingredientId: string;
    type: "opening" | "restock";
    qtyDelta: string;
    note: string | null;
    refType?: string;
    refId?: string;
    createdBy: string;
    now: Date;
  },
  db: DbExecutor,
) {
  const { now, ...row } = values;
  await db.insert(stockMovements).values({ ...row, createdAt: now });
}

export async function lockIngredient(id: string, db: DbExecutor) {
  const [row] = await db
    .select({ ...ingredientColumns, unitLocked: inUse })
    .from(ingredients)
    .where(eq(ingredients.id, id))
    .for("update", { of: ingredients });
  return row;
}

// Sale deduction (P2-04): the ingredients an order uses, locked for update in
// id order after the order row (Schema §5 lock order), so parallel payments
// queue instead of deadlocking.
export function lockIngredientsForUpdate(ids: string[], db: DbExecutor) {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: ingredients.id,
      stockQty: ingredients.stockQty,
      avgCost: ingredients.avgCost,
    })
    .from(ingredients)
    .where(inArray(ingredients.id, ids))
    .orderBy(asc(ingredients.id))
    .for("update");
}

// One sale_deduction movement per ingredient of an order, and the matching
// change to stock_qty (Schema §4 I7). System rows: created_by is null.
export async function insertSaleDeductions(
  orderId: string,
  rows: { ingredientId: string; qtyDelta: string }[],
  now: Date,
  db: DbExecutor,
) {
  if (rows.length === 0) return;
  await db.insert(stockMovements).values(
    rows.map((row) => ({
      ingredientId: row.ingredientId,
      type: "sale_deduction" as const,
      qtyDelta: row.qtyDelta,
      refType: "order",
      refId: orderId,
      createdBy: null,
      createdAt: now,
    })),
  );
  for (const row of rows) {
    await db
      .update(ingredients)
      .set({
        stockQty: sql`${ingredients.stockQty} + ${row.qtyDelta}::numeric`,
        updatedAt: now,
      })
      .where(eq(ingredients.id, row.ingredientId));
  }
}

// Restock (P2-05): the purchased ingredients, locked for update in id order
// (Schema §5 lock order) so parallel restocks and payments queue.
export function lockIngredientsForRestock(ids: string[], db: DbExecutor) {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      isActive: ingredients.isActive,
      stockQty: ingredients.stockQty,
      avgCost: ingredients.avgCost,
    })
    .from(ingredients)
    .where(inArray(ingredients.id, ids))
    .orderBy(asc(ingredients.id))
    .for("update");
}

export async function insertRestock(
  values: {
    ingredientId: string;
    supplierId: string | null;
    quantity: string;
    totalCost: number;
    purchasedOn: string;
    createdBy: string;
    now: Date;
  },
  db: DbExecutor,
) {
  const { now, ...row } = values;
  const [created] = await db
    .insert(restocks)
    .values({ ...row, createdAt: now })
    .returning({ id: restocks.id });
  return created!;
}

// Stock and average cost together; the caller holds the row lock and has
// written the matching ledger row.
export async function setStockAndCost(
  id: string,
  values: { stockQty: string; avgCost: string },
  now: Date,
  db: DbExecutor,
) {
  await db
    .update(ingredients)
    .set({ ...values, updatedAt: now })
    .where(eq(ingredients.id, id));
}

// S-09 / O-07 pickers: active ingredients with stock and cost, by name.
export function selectActiveIngredients(db: DbExecutor = getDb()) {
  return db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      stockQty: ingredients.stockQty,
      avgCost: ingredients.avgCost,
    })
    .from(ingredients)
    .where(eq(ingredients.isActive, true))
    .orderBy(asc(ingredients.name));
}

// Availability (P2-03): current stock of the given ingredients, unlocked.
export function selectStockLevels(ids: string[], db: DbExecutor = getDb()) {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      stockQty: ingredients.stockQty,
    })
    .from(ingredients)
    .where(inArray(ingredients.id, ids));
}

// Recipes and modifier deltas (P2-02): the ingredients they name, share-locked
// in id order so a unit change (lockIngredient, for update) cannot slip past.
export function lockIngredientsForShare(ids: string[], db: DbExecutor) {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      unit: ingredients.unit,
      isActive: ingredients.isActive,
    })
    .from(ingredients)
    .where(inArray(ingredients.id, ids))
    .orderBy(asc(ingredients.id))
    .for("share");
}

export async function updateIngredient(
  id: string,
  values: Partial<
    Pick<IngredientRow, "name" | "kind" | "unit" | "minStockQty" | "isActive">
  >,
  now: Date,
  db: DbExecutor,
) {
  await db
    .update(ingredients)
    .set({ ...values, updatedAt: now })
    .where(eq(ingredients.id, id));
}

// --- Suppliers ---

export type SupplierRow = {
  id: string;
  name: string;
  note: string | null;
  isActive: boolean;
};

const supplierColumns = {
  id: suppliers.id,
  name: suppliers.name,
  note: suppliers.note,
  isActive: suppliers.isActive,
};

export async function selectAllSuppliers(db: DbExecutor = getDb()) {
  return db
    .select(supplierColumns)
    .from(suppliers)
    .orderBy(asc(suppliers.name));
}

export function selectActiveSuppliers(db: DbExecutor = getDb()) {
  return db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.isActive, true))
    .orderBy(asc(suppliers.name));
}

// Restock (P2-05): the suppliers a save names, share-locked so one cannot be
// switched off until it commits.
export function lockSuppliersForShare(ids: string[], db: DbExecutor) {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      isActive: suppliers.isActive,
    })
    .from(suppliers)
    .where(inArray(suppliers.id, ids))
    .orderBy(asc(suppliers.id))
    .for("share");
}

export async function lockSupplierNames(db: DbExecutor) {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('suppliers.name', 0))`,
  );
}

export async function findSupplierByName(
  name: string,
  exceptId: string | null,
  db: DbExecutor,
) {
  const [row] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(
      and(
        eq(sql`lower(${suppliers.name})`, name.toLowerCase()),
        exceptId ? ne(suppliers.id, exceptId) : undefined,
      ),
    );
  return row;
}

export async function insertSupplier(
  values: Omit<SupplierRow, "id">,
  db: DbExecutor,
): Promise<SupplierRow> {
  const [created] = await db
    .insert(suppliers)
    .values(values)
    .returning(supplierColumns);
  return created!;
}

export async function lockSupplier(id: string, db: DbExecutor) {
  const [row] = await db
    .select(supplierColumns)
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .for("update");
  return row;
}

export async function updateSupplier(
  id: string,
  values: Partial<Omit<SupplierRow, "id">>,
  db: DbExecutor,
) {
  await db.update(suppliers).set(values).where(eq(suppliers.id, id));
}
