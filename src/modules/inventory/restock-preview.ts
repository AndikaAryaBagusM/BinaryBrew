import { weightedAverageCost } from "@/lib/money";
import { toMilli } from "@/lib/quantity";

// S-09 and O-07 preview (FR-IV-05, Design §7): the average cost each line
// will leave, worked out the way the server does (Schema §5.5, lines in
// order, so an ingredient on two rows averages twice). Pure; the server
// recomputes from the locked rows when it saves.

export type PreviewIngredient = {
  id: string;
  stockQty: string;
  avgCost: string;
};

export type PreviewLine = {
  ingredientId: string | null;
  quantityMilli: number | null;
  totalCost: number | null;
};

export type LinePreview = {
  avgCostBefore: string;
  avgCostAfter: string;
  stockMilliAfter: number;
};

// null for a line that is not complete yet; it does not change later lines.
export function previewRestocks(
  ingredients: readonly PreviewIngredient[],
  lines: readonly PreviewLine[],
): (LinePreview | null)[] {
  const state = new Map(
    ingredients.map((row) => [
      row.id,
      { stockMilli: toMilli(row.stockQty), avgCost: row.avgCost },
    ]),
  );
  return lines.map((line) => {
    const before = line.ingredientId ? state.get(line.ingredientId) : undefined;
    if (
      !before ||
      line.quantityMilli === null ||
      line.quantityMilli <= 0 ||
      line.totalCost === null ||
      line.totalCost < 0
    ) {
      return null;
    }
    const after = {
      stockMilli: before.stockMilli + line.quantityMilli,
      avgCost: weightedAverageCost(before, {
        quantityMilli: line.quantityMilli,
        totalCost: line.totalCost,
      }),
    };
    state.set(line.ingredientId!, after);
    return {
      avgCostBefore: before.avgCost,
      avgCostAfter: after.avgCost,
      stockMilliAfter: after.stockMilli,
    };
  });
}
