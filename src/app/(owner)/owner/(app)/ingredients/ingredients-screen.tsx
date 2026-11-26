"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Truck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/button";
import { type MessageKey, t } from "@/i18n";
import { api, type Json } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatUnitCost, isZeroCost } from "@/lib/money";
import { formatQuantity, toMilli } from "@/lib/quantity";
import type { getOwnerIngredients } from "@/modules/inventory/service";
import { STOCK_STATES, stockState } from "@/modules/inventory/status";
import {
  PageBody,
  PageHead,
  TableCard,
  Tag,
  tdClass,
  thClass,
  useSignedOutGuard,
} from "../owner-ui";
import { IngredientPanel } from "./ingredient-panel";
import { kindLabel, statusChip, statusOf } from "./labels";
import { SuppliersPanel } from "./suppliers-panel";

export type IngredientsData = Json<
  Awaited<ReturnType<typeof getOwnerIngredients>>
>;
export type IngredientData = IngredientsData["ingredients"][number];
export type SupplierData = IngredientsData["suppliers"][number];

const INGREDIENTS_QUERY = ["owner", "ingredients"] as const;

type Panel =
  | { kind: "ingredient"; ingredient: IngredientData | null }
  | { kind: "suppliers" }
  | null;

const summaryLabel: Record<(typeof STOCK_STATES)[number], MessageKey> = {
  ok: "owner.stockSummaryOk",
  low: "owner.stockSummaryLow",
  empty: "owner.stockSummaryEmpty",
  minus: "owner.stockSummaryMinus",
};

// O-05: every ingredient with its stock, minimum, average cost and one
// status chip (Design §6). Stock never changes here: it follows restocks,
// paid orders and stock counts through the ledger (Schema §3.5). Inactive
// ingredients stay listed, greyed, at the bottom.
export function IngredientsScreen({ initial }: { initial: IngredientsData }) {
  const queryClient = useQueryClient();
  const signedOut = useSignedOutGuard();
  const [panel, setPanel] = useState<Panel>(null);

  const { data } = useQuery({
    queryKey: INGREDIENTS_QUERY,
    queryFn: async () => {
      const result = await api<IngredientsData>("/api/owner/ingredients");
      if (signedOut(result)) return initial;
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    initialData: initial,
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: INGREDIENTS_QUERY });
  }

  const rows = [...data.ingredients].sort(
    (a, b) => Number(b.isActive) - Number(a.isActive),
  );
  const counts = new Map<string, number>();
  for (const ingredient of data.ingredients) {
    if (!ingredient.isActive) continue;
    const state = stockState(statusOf(ingredient));
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }

  return (
    <PageBody>
      <PageHead
        title={t("owner.ingredientsTitle")}
        subtitle={t("owner.ingredientsSubtitle")}
      >
        <Button
          variant="secondary"
          icon={<Truck aria-hidden="true" />}
          onClick={() => setPanel({ kind: "suppliers" })}
        >
          {t("owner.suppliers")}
        </Button>
        <Button
          icon={<Plus aria-hidden="true" />}
          onClick={() => setPanel({ kind: "ingredient", ingredient: null })}
        >
          {t("owner.addIngredient")}
        </Button>
      </PageHead>

      <ul
        aria-label={t("owner.stockSummaryLabel")}
        className="flex flex-wrap gap-2"
      >
        {STOCK_STATES.map((state) => (
          <li key={state}>
            <Tag tone={statusChip[state].tone}>
              {t(summaryLabel[state], { n: counts.get(state) ?? 0 })}
            </Tag>
          </li>
        ))}
      </ul>

      <TableCard label={t("owner.ingredientsTitle")} minWidth="min-w-240">
        <thead>
          <tr>
            <th scope="col" className={thClass}>
              {t("owner.colIngredient")}
            </th>
            <th scope="col" className={`${thClass} w-32`}>
              {t("owner.colKind")}
            </th>
            <th scope="col" className={`${thClass} w-22`}>
              {t("owner.colUnit")}
            </th>
            <th scope="col" className={`${thClass} w-28 text-right`}>
              {t("owner.colStock")}
            </th>
            <th scope="col" className={`${thClass} w-28 text-right`}>
              {t("owner.colMinimum")}
            </th>
            <th scope="col" className={`${thClass} w-36 text-right`}>
              {t("owner.colAvgCost")}
            </th>
            <th scope="col" className={`${thClass} w-44`}>
              {t("owner.colStatus")}
            </th>
            <th scope="col" className={`${thClass} w-18`}>
              <span className="sr-only">{t("owner.colActions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className={`${tdClass} text-ink-muted`}>
                {t("owner.ingredientsEmpty")}
              </td>
            </tr>
          )}
          {rows.map((ingredient) => {
            const status = statusOf(ingredient);
            const chip = statusChip[status];
            return (
              // A click anywhere on the row opens the edit panel; keyboard
              // users have the pencil button.
              <tr
                key={ingredient.id}
                onClick={() => setPanel({ kind: "ingredient", ingredient })}
                className={cn(
                  "cursor-pointer",
                  !ingredient.isActive && "text-ink-muted",
                  ingredient.isActive && status === "minus"
                    ? "bg-danger-soft"
                    : "hover:bg-bg",
                )}
              >
                <th scope="row" className={`${tdClass} font-semibold`}>
                  {ingredient.name}
                </th>
                <td className={tdClass}>{t(kindLabel[ingredient.kind])}</td>
                <td className={tdClass}>{ingredient.unit}</td>
                <td className={`${tdClass} text-right tabular-nums`}>
                  {formatQuantity(toMilli(ingredient.stockQty))}
                </td>
                <td className={`${tdClass} text-right tabular-nums`}>
                  {formatQuantity(toMilli(ingredient.minStockQty))}
                </td>
                <td
                  className={`${tdClass} text-right whitespace-nowrap tabular-nums`}
                >
                  {isZeroCost(ingredient.avgCost)
                    ? "—"
                    : formatUnitCost(ingredient.avgCost)}
                </td>
                <td className={tdClass}>
                  {ingredient.isActive ? (
                    <Tag tone={chip.tone}>{t(chip.label)}</Tag>
                  ) : (
                    <Tag tone="expired">{t("owner.inactive")}</Tag>
                  )}
                </td>
                <td className={tdClass}>
                  <button
                    type="button"
                    aria-label={t("owner.editItem", { name: ingredient.name })}
                    onClick={(event) => {
                      event.stopPropagation();
                      setPanel({ kind: "ingredient", ingredient });
                    }}
                    className="focus-ring flex size-11 cursor-pointer items-center justify-center rounded-card text-ink active:bg-accent-soft"
                  >
                    <Pencil aria-hidden="true" size={20} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableCard>

      {panel?.kind === "ingredient" && (
        <IngredientPanel
          ingredient={panel.ingredient}
          onSaved={refresh}
          onClose={() => setPanel(null)}
        />
      )}
      {panel?.kind === "suppliers" && (
        <SuppliersPanel
          suppliers={data.suppliers}
          onChanged={refresh}
          onClose={() => setPanel(null)}
        />
      )}
    </PageBody>
  );
}
