"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackagePlus, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/button";
import { type MessageKey, t } from "@/i18n";
import { api, type Json } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import {
  compareCost,
  formatRupiah,
  formatUnitCost,
  isZeroCost,
  parseRupiahInput,
} from "@/lib/money";
import { fromMilli, parseQuantityInput } from "@/lib/quantity";
import { previewRestocks } from "@/modules/inventory/restock-preview";
import {
  MAX_RESTOCK_LINES,
  MAX_RESTOCK_TOTAL,
} from "@/modules/inventory/schemas";
import type { RestockOptions } from "@/modules/inventory/service";
import { INGREDIENTS_QUERY } from "../owner-queries";
import {
  Notice,
  PageBody,
  PageHead,
  TableCard,
  tdClass,
  thClass,
  useSignedOutGuard,
} from "../owner-ui";

export type RestockOptionsData = Json<RestockOptions>;

type Row = {
  key: number;
  ingredientId: string;
  quantity: string;
  total: string;
  supplierId: string;
  purchasedOn: string;
};
type Field = "ingredient" | "quantity" | "total" | "date";

const OPTIONS_QUERY = ["owner", "restock-options"] as const;

const fieldLabel: Record<Field, MessageKey> = {
  ingredient: "owner.colIngredient",
  quantity: "owner.colQuantity",
  total: "owner.colTotalCost",
  date: "owner.colDate",
};
const fieldError: Record<Field, MessageKey> = {
  ingredient: "owner.restockIngredientRequired",
  quantity: "owner.quantityInvalid",
  total: "owner.totalCostInvalid",
  date: "owner.restockDateInvalid",
};

const cellInput =
  "focus-ring h-10 w-full rounded-control border bg-surface px-3 text-owner-body text-ink";
const border = (invalid: boolean) =>
  invalid ? "border-2 border-danger" : "border-border-strong";

let nextKey = 0;
const blankRow = (today: string): Row => ({
  key: nextKey++,
  ingredientId: "",
  quantity: "",
  total: "",
  supplierId: "",
  purchasedOn: today,
});

// O-07 Restock entry (Figma 20:950, FR-IV-05): several purchases saved
// together. Each row previews the average cost it will leave, in row order
// (Schema §5.5, the same function as S-09); the server recomputes from the
// locked rows. The date defaults to today and may not be later.
export function RestockScreen({
  initial,
  today,
}: {
  initial: RestockOptionsData;
  today: string;
}) {
  const queryClient = useQueryClient();
  const signedOut = useSignedOutGuard();
  const [rows, setRows] = useState<Row[]>(() => [blankRow(today)]);
  const [errors, setErrors] = useState<Map<number, Field[]>>(new Map());
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({
    queryKey: OPTIONS_QUERY,
    queryFn: async () => {
      const result = await api<RestockOptionsData>(
        "/api/counter/restock-options",
      );
      if (signedOut(result)) return initial;
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    initialData: initial,
  });
  const byId = new Map(data.ingredients.map((row) => [row.id, row]));

  const parsed = rows.map((row) => ({
    row,
    ingredient: byId.get(row.ingredientId),
    quantityMilli: parseQuantityInput(row.quantity),
    totalCost: parseRupiahInput(row.total),
  }));
  const previews = previewRestocks(
    data.ingredients,
    parsed.map((line) => ({
      ingredientId: line.ingredient ? line.row.ingredientId : null,
      quantityMilli: line.quantityMilli,
      totalCost: line.totalCost,
    })),
  );
  const purchaseTotal = parsed.reduce(
    (sum, line) => sum + (line.totalCost ?? 0),
    0,
  );

  function update(key: number, patch: Partial<Row>) {
    setSaved(null);
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function validate() {
    const next = new Map<number, Field[]>();
    for (const line of parsed) {
      const bad: Field[] = [];
      if (!line.ingredient) bad.push("ingredient");
      if (line.quantityMilli === null || line.quantityMilli <= 0) {
        bad.push("quantity");
      }
      if (line.totalCost === null || line.totalCost > MAX_RESTOCK_TOTAL) {
        bad.push("total");
      }
      if (line.row.purchasedOn > today) bad.push("date");
      if (bad.length > 0) next.set(line.row.key, bad);
    }
    setErrors(next);
    return next.size === 0;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(null);
    if (!validate()) return;
    setBusy(true);
    setFailure(null);
    const result = await api<{ restocks: unknown[] }>("/api/counter/restocks", {
      method: "POST",
      body: {
        lines: parsed.map((line) => ({
          ingredientId: line.row.ingredientId,
          quantity: fromMilli(line.quantityMilli!),
          totalCost: line.totalCost!,
          supplierId: line.row.supplierId || null,
          purchasedOn: line.row.purchasedOn || null,
        })),
      },
    });
    setBusy(false);
    if (signedOut(result)) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: OPTIONS_QUERY }),
      queryClient.invalidateQueries({ queryKey: INGREDIENTS_QUERY }),
    ]);
    if (!result.ok) {
      setFailure(result.error.message);
      return;
    }
    setSaved(t("owner.restockSaved", { n: result.data.restocks.length }));
    setRows([blankRow(today)]);
  }

  const rowErrors = rows.flatMap((row, index) =>
    (errors.get(row.key) ?? []).map((field) =>
      t("owner.restockRowError", {
        n: index + 1,
        message: t(fieldError[field]),
      }),
    ),
  );

  return (
    <PageBody>
      <PageHead
        title={t("owner.restockTitle")}
        subtitle={t("owner.restockSubtitle")}
      />
      {data.ingredients.length === 0 ? (
        <p className="text-owner-body text-ink-muted">
          {t("owner.restockEmpty")}
        </p>
      ) : (
        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-5"
        >
          {failure && <Notice tone="danger">{failure}</Notice>}
          {rowErrors.length > 0 && (
            <div
              role="alert"
              className="rounded-card bg-danger-soft px-4 py-3 text-owner-body font-medium text-danger"
            >
              {rowErrors.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          )}
          {saved && <Notice tone="success">{saved}</Notice>}

          <TableCard label={t("owner.restockTitle")} minWidth="min-w-272">
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  {t("owner.colIngredient")}
                </th>
                <th scope="col" className={`${thClass} w-32`}>
                  {t("owner.colQuantity")}
                </th>
                <th scope="col" className={`${thClass} w-38`}>
                  {t("owner.colTotalCost")}
                </th>
                <th scope="col" className={`${thClass} w-48`}>
                  {t("owner.colSupplier")}
                </th>
                <th scope="col" className={`${thClass} w-40`}>
                  {t("owner.colDate")}
                </th>
                <th scope="col" className={`${thClass} w-44`}>
                  {t("owner.colNewAvgCost")}
                </th>
                <th scope="col" className={`${thClass} w-16`}>
                  <span className="sr-only">{t("owner.colActions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {parsed.map(({ row, ingredient }, index) => {
                const n = index + 1;
                const bad = new Set(errors.get(row.key) ?? []);
                const label = (field: Field) =>
                  t("owner.restockField", { field: t(fieldLabel[field]), n });
                const preview = previews[index];
                return (
                  <tr key={row.key}>
                    <td className={`${tdClass} py-2`}>
                      <select
                        aria-label={label("ingredient")}
                        aria-invalid={bad.has("ingredient") || undefined}
                        value={row.ingredientId}
                        onChange={(event) =>
                          update(row.key, { ingredientId: event.target.value })
                        }
                        className={cn(
                          cellInput,
                          "cursor-pointer",
                          border(bad.has("ingredient")),
                        )}
                      >
                        <option value="">
                          {t("owner.restockPickIngredient")}
                        </option>
                        {data.ingredients.map((option) => (
                          <option key={option.id} value={option.id}>
                            {t("owner.restockIngredientOption", {
                              name: option.name,
                              unit: option.unit,
                            })}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={`${tdClass} py-2`}>
                      <div className="relative">
                        <input
                          aria-label={label("quantity")}
                          aria-invalid={bad.has("quantity") || undefined}
                          inputMode="decimal"
                          autoComplete="off"
                          value={row.quantity}
                          onChange={(event) =>
                            update(row.key, { quantity: event.target.value })
                          }
                          className={cn(
                            cellInput,
                            "pr-10 tabular-nums",
                            border(bad.has("quantity")),
                          )}
                        />
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-caption text-ink-muted"
                        >
                          {ingredient?.unit}
                        </span>
                      </div>
                    </td>
                    <td className={`${tdClass} py-2`}>
                      <div className="relative">
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-owner-body text-ink-muted"
                        >
                          Rp
                        </span>
                        <input
                          aria-label={label("total")}
                          aria-invalid={bad.has("total") || undefined}
                          inputMode="numeric"
                          autoComplete="off"
                          value={row.total}
                          onChange={(event) =>
                            update(row.key, { total: event.target.value })
                          }
                          className={cn(
                            cellInput,
                            "pl-10 tabular-nums",
                            border(bad.has("total")),
                          )}
                        />
                      </div>
                    </td>
                    <td className={`${tdClass} py-2`}>
                      <select
                        aria-label={t("owner.restockField", {
                          field: t("owner.colSupplier"),
                          n,
                        })}
                        value={row.supplierId}
                        onChange={(event) =>
                          update(row.key, { supplierId: event.target.value })
                        }
                        className={cn(
                          cellInput,
                          "cursor-pointer",
                          border(false),
                        )}
                      >
                        <option value="">{t("owner.restockNoSupplier")}</option>
                        {data.suppliers.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={`${tdClass} py-2`}>
                      <input
                        type="date"
                        aria-label={label("date")}
                        aria-invalid={bad.has("date") || undefined}
                        max={today}
                        value={row.purchasedOn}
                        onChange={(event) =>
                          update(row.key, { purchasedOn: event.target.value })
                        }
                        className={cn(cellInput, border(bad.has("date")))}
                      />
                    </td>
                    <td className={`${tdClass} py-2`}>
                      {preview && ingredient ? (
                        <>
                          <p className="font-semibold whitespace-nowrap tabular-nums">
                            {t("owner.restockCost", {
                              cost: formatUnitCost(preview.avgCostAfter),
                              unit: ingredient.unit,
                            })}
                          </p>
                          <p className="text-caption whitespace-nowrap text-ink-muted">
                            {change(
                              preview.avgCostBefore,
                              preview.avgCostAfter,
                            )}
                          </p>
                        </>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className={`${tdClass} py-2`}>
                      <button
                        type="button"
                        aria-label={t("owner.restockRemoveRow", { n })}
                        disabled={rows.length === 1}
                        onClick={() => {
                          setSaved(null);
                          setRows((current) =>
                            current.filter((other) => other.key !== row.key),
                          );
                        }}
                        className="focus-ring flex size-10 cursor-pointer items-center justify-center rounded-card text-ink active:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Trash2 aria-hidden="true" size={18} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableCard>

          <div>
            <Button
              variant="ghost"
              icon={<Plus aria-hidden="true" />}
              disabled={rows.length >= MAX_RESTOCK_LINES}
              onClick={() => {
                setSaved(null);
                setRows((current) => [...current, blankRow(today)]);
              }}
            >
              {t("owner.restockAddRow")}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-4 rounded-card bg-surface px-4 py-4 sm:px-5">
            <div className="flex-1 basis-40 whitespace-nowrap">
              <p className="text-caption text-ink-muted">
                {t("owner.restockTotal")}
              </p>
              <p className="text-h1 text-ink tabular-nums">
                {formatRupiah(purchaseTotal)}
              </p>
            </div>
            <Button
              type="submit"
              loading={busy}
              icon={<PackagePlus aria-hidden="true" />}
            >
              {t("owner.restockSave", { n: rows.length })}
            </Button>
          </div>
        </form>
      )}
    </PageBody>
  );
}

// "naik dari Rp 17,90", "turun dari …", "tetap", or "biaya pertama".
// Compared as shown (2 decimals), so "naik dari Rp 17,90" never sits under
// a new average that also reads Rp 17,90.
function change(before: string, after: string): string {
  if (isZeroCost(before)) return t("owner.restockFirst");
  const direction = compareCost(after, before);
  if (direction === 0 || formatUnitCost(after) === formatUnitCost(before)) {
    return t("owner.restockSame");
  }
  return t(direction > 0 ? "owner.restockUp" : "owner.restockDown", {
    cost: formatUnitCost(before),
  });
}
