import type { MessageKey } from "@/i18n";
import { isZeroCost } from "@/lib/money";
import { toMilli } from "@/lib/quantity";
import { type StockStatus, stockStatus } from "@/modules/inventory/status";
import type { TagTone } from "../owner-ui";
import type { IngredientData } from "./ingredients-screen";

// O-05 labels shared by the table and the panel.

export const statusChip: Record<
  StockStatus,
  { label: MessageKey; tone: TagTone }
> = {
  ok: { label: "owner.stockOk", tone: "ready" },
  low: { label: "owner.stockLow", tone: "waiting" },
  empty: { label: "owner.stockEmpty", tone: "expired" },
  minus: { label: "owner.stockMinus", tone: "danger" },
  no_cost: { label: "owner.stockNoCost", tone: "info" },
};

export const kindLabel: Record<IngredientData["kind"], MessageKey> = {
  raw: "owner.kindRaw",
  resale: "owner.kindResale",
};

export function statusOf(ingredient: IngredientData): StockStatus {
  return stockStatus({
    stockMilli: toMilli(ingredient.stockQty),
    minMilli: toMilli(ingredient.minStockQty),
    hasCost: !isZeroCost(ingredient.avgCost),
  });
}
