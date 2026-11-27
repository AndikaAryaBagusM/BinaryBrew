import { isZeroCost, recipeCost } from "@/lib/money";
import { toMilli } from "@/lib/quantity";

// FR-HP-01: a menu item's HPP from its current recipe and the ingredients'
// weighted-average costs, rounded once (money.recipeCost), the same rule as
// O-06's preview and order_items.unit_cogs. Pure.
//
// - no_recipe: no recipe lines, HPP unknown (null), never 0.
// - incomplete: a recipe ingredient has no cost yet; it counts as 0, so the
//   HPP is too low ("Resep belum lengkap").
// - complete: every ingredient has a cost.

export type ItemCostStatus = "no_recipe" | "incomplete" | "complete";
export type ItemCost = { status: ItemCostStatus; hpp: number | null };

export function itemCost(
  recipe: readonly { ingredientId: string; qty: string }[],
  avgCosts: ReadonlyMap<string, string>,
): ItemCost {
  if (recipe.length === 0) return { status: "no_recipe", hpp: null };
  const lines = recipe.map((line) => ({
    quantityMilli: toMilli(line.qty),
    avgCost: avgCosts.get(line.ingredientId) ?? "0",
  }));
  return {
    status: lines.some((line) => isZeroCost(line.avgCost))
      ? "incomplete"
      : "complete",
    hpp: recipeCost(lines),
  };
}
