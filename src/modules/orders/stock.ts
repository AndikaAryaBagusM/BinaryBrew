import { toMilli } from "@/lib/quantity";

// What an order takes from stock (FR-IV-04, Schema §5.1 step 4). Pure: the
// caller loads recipes, option deltas and stock levels. Quantities are in
// thousandths of each ingredient's base unit (lib/quantity.ts).
//
// One unit of a line needs its item's recipe plus the deltas of the options
// chosen on it. Per line and ingredient the need never goes below zero: an
// option that "uses less" of something the item does not contain (Susu oat's
// -150 ml UHT on an Americano) cannot free stock for other lines. The same
// rule is used for the deduction at payment (P2-04).

export type StockItem = {
  id: string;
  name: string;
  recipe: readonly { ingredientId: string; qty: string }[];
  modifierGroups: readonly {
    options: readonly {
      id: string;
      ingredientDeltas: readonly IngredientDelta[];
    }[];
  }[];
};

export type StockLine = {
  menuItemId: string;
  quantity: number;
  modifierOptionIds: readonly string[];
};

export type IngredientDelta = { ingredientId: string; qtyDelta: string };

// What one unit of a line needs: the recipe plus the given option deltas,
// only the ingredients it needs more than zero of. Checkout passes the deltas
// of the chosen options; payment passes the order snapshot (P2-04).
export function unitStockNeeds(
  recipe: StockItem["recipe"],
  deltas: readonly IngredientDelta[],
): Map<string, number> {
  const perUnit = new Map<string, number>();
  const add = (ingredientId: string, milli: number) =>
    perUnit.set(ingredientId, (perUnit.get(ingredientId) ?? 0) + milli);
  for (const row of recipe) add(row.ingredientId, toMilli(row.qty));
  for (const delta of deltas) add(delta.ingredientId, toMilli(delta.qtyDelta));
  for (const [ingredientId, milli] of perUnit) {
    if (milli <= 0) perUnit.delete(ingredientId);
  }
  return perUnit;
}

// The positive need of one line, all its units together.
export function lineStockNeeds(
  line: StockLine,
  item: StockItem,
): Map<string, number> {
  const chosen = new Set(line.modifierOptionIds);
  const deltas = item.modifierGroups.flatMap((group) =>
    group.options
      .filter((option) => chosen.has(option.id))
      .flatMap((option) => option.ingredientDeltas),
  );
  return scaleNeeds(unitStockNeeds(item.recipe, deltas), line.quantity);
}

export function scaleNeeds(
  needs: ReadonlyMap<string, number>,
  quantity: number,
): Map<string, number> {
  return new Map([...needs].map(([id, milli]) => [id, milli * quantity]));
}

// The whole order's need per ingredient. Lines whose item is unknown are
// skipped (checkout refuses them before this runs).
export function orderStockNeeds(
  lines: readonly StockLine[],
  items: readonly StockItem[],
): Map<string, number> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const totals = new Map<string, number>();
  for (const line of lines) {
    const item = byId.get(line.menuItemId);
    if (!item) continue;
    for (const [ingredientId, milli] of lineStockNeeds(line, item)) {
      totals.set(ingredientId, (totals.get(ingredientId) ?? 0) + milli);
    }
  }
  return totals;
}

// Items of the order that use an ingredient the whole order needs more of
// than is in stock (an unknown ingredient counts as none), once each, in
// request order. Empty when the order fits.
export function stockShortfalls(
  lines: readonly StockLine[],
  items: readonly StockItem[],
  stockMilli: ReadonlyMap<string, number>,
): { menuItemId: string; name: string }[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const totals = orderStockNeeds(lines, items);
  const short = new Set(
    [...totals]
      .filter(([id, milli]) => milli > (stockMilli.get(id) ?? 0))
      .map(([id]) => id),
  );
  if (short.size === 0) return [];
  const result: { menuItemId: string; name: string }[] = [];
  for (const line of lines) {
    const item = byId.get(line.menuItemId);
    if (!item || result.some((row) => row.menuItemId === item.id)) continue;
    const needs = lineStockNeeds(line, item);
    if ([...needs.keys()].some((id) => short.has(id))) {
      result.push({ menuItemId: item.id, name: item.name });
    }
  }
  return result;
}
