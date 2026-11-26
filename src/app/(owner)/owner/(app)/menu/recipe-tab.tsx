"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Info, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/button";
import { SelectField, TextField } from "@/components/field";
import { t } from "@/i18n";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import {
  formatMargin,
  formatRupiah,
  formatUnitCost,
  isZeroCost,
  lineCost,
  recipeCost,
} from "@/lib/money";
import {
  fromMilli,
  parseQuantityInput,
  quantityInputText,
  toMilli,
} from "@/lib/quantity";
import {
  type IngredientData,
  INGREDIENTS_QUERY,
  itemDetailsQuery,
  useIngredients,
  useItemDetails,
} from "../owner-queries";
import {
  Notice,
  StatCard,
  tdClass,
  thClass,
  useSignedOutGuard,
} from "../owner-ui";
import type { OwnerItemData } from "./menu-screen";

type DraftLine = { ingredientId: string; qty: string };

// O-06 "Resep" (FR-IV-02, Figma 19:1632): one serving of the item in each
// ingredient's base unit, with the HPP and margin worked out live from the
// current average costs (lib/money.ts). An ingredient without a cost yet
// counts as 0 and is called out. Saving replaces the whole recipe.
export function RecipeTab({ item }: { item: OwnerItemData }) {
  const details = useItemDetails(item.id);
  const ingredients = useIngredients();

  if (details.isError || ingredients.isError) {
    return (
      <div className="px-6 pt-4">
        <Notice tone="danger">{t("error.generic")}</Notice>
      </div>
    );
  }
  if (!details.data || !ingredients.data) {
    return (
      <p role="status" className="px-6 pt-4 text-owner-body text-ink-muted">
        {t("common.loading")}
      </p>
    );
  }
  return (
    // Stays mounted across a save: the draft then equals the saved recipe.
    <RecipeEditor
      item={item}
      saved={details.data.recipe}
      ingredients={ingredients.data.ingredients}
    />
  );
}

function RecipeEditor({
  item,
  saved,
  ingredients,
}: {
  item: OwnerItemData;
  saved: DraftLine[];
  ingredients: IngredientData[];
}) {
  const queryClient = useQueryClient();
  const signedOut = useSignedOutGuard();
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const [lines, setLines] = useState<DraftLine[]>(() =>
    saved.map((line) => ({
      ingredientId: line.ingredientId,
      qty: quantityInputText(toMilli(line.qty)),
    })),
  );
  const [adding, setAdding] = useState({ ingredientId: "", qty: "" });
  const [addError, setAddError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [busy, setBusy] = useState(false);

  const parsed = lines.map((line) => ({
    ...line,
    milli: parseQuantityInput(line.qty),
    ingredient: byId.get(line.ingredientId)!,
  }));
  const invalid = parsed.some((line) => !line.milli || line.milli <= 0);
  const costLines = parsed
    .filter((line) => line.milli && line.milli > 0)
    .map((line) => ({
      quantityMilli: line.milli!,
      avgCost: line.ingredient.avgCost,
    }));
  const hpp = recipeCost(costLines);
  const noCost = parsed.filter((line) => isZeroCost(line.ingredient.avgCost));
  const normalized = (list: { ingredientId: string; qty: string }[]) =>
    JSON.stringify(
      list.map((line) => `${line.ingredientId}:${line.qty}`).sort(),
    );
  const body = parsed.map((line) => ({
    ingredientId: line.ingredientId,
    qty: line.milli && line.milli > 0 ? fromMilli(line.milli) : line.qty,
  }));
  const changed =
    normalized(body) !==
    normalized(
      saved.map((line) => ({
        ingredientId: line.ingredientId,
        qty: fromMilli(toMilli(line.qty)),
      })),
    );

  const available = ingredients.filter(
    (i) => i.isActive && !lines.some((line) => line.ingredientId === i.id),
  );
  const addingUnit = byId.get(adding.ingredientId)?.unit;

  function add(event: FormEvent) {
    event.preventDefault();
    const milli = parseQuantityInput(adding.qty);
    if (!adding.ingredientId) return;
    if (!milli || milli <= 0) {
      setAddError(t("owner.quantityInvalid"));
      return;
    }
    setAddError(null);
    setSavedNotice(false);
    setLines((current) => [
      ...current,
      { ingredientId: adding.ingredientId, qty: quantityInputText(milli) },
    ]);
    setAdding({ ingredientId: "", qty: "" });
  }

  async function save() {
    setBusy(true);
    setFailure(null);
    const result = await api(`/api/owner/menu-items/${item.id}/recipe`, {
      method: "PUT",
      body: { lines: body },
    });
    if (signedOut(result)) return;
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error.message);
      return;
    }
    // Saved lines lock their ingredients' unit (O-05).
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: itemDetailsQuery(item.id) }),
      queryClient.invalidateQueries({ queryKey: INGREDIENTS_QUERY }),
    ]);
    setSavedNotice(true);
  }

  const margin = lines.length > 0 ? item.price - hpp : null;

  return (
    <div className="flex flex-1 flex-col gap-4 px-6 pt-4 pb-6">
      {failure && <Notice tone="danger">{failure}</Notice>}
      {savedNotice && !changed && (
        <Notice tone="success">{t("owner.recipeSaved")}</Notice>
      )}

      <div className="flex flex-wrap gap-3">
        <StatCard
          label={t("owner.sellingPrice")}
          value={formatRupiah(item.price)}
        />
        <StatCard
          label={t("owner.hpp")}
          value={lines.length > 0 ? formatRupiah(hpp) : "—"}
        />
        <StatCard
          label={t("owner.margin")}
          tone={margin === null ? "default" : margin < 0 ? "danger" : "success"}
          value={margin === null ? "—" : formatMargin(item.price, hpp)}
        />
      </div>

      <div className="relative overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full min-w-110 table-fixed border-collapse text-left text-owner-body text-ink">
          <caption className="sr-only">{t("owner.tabRecipe")}</caption>
          <thead>
            <tr>
              <th scope="col" className={thClass}>
                {t("owner.colIngredient")}
              </th>
              <th scope="col" className={`${thClass} w-30 text-right`}>
                {t("owner.colQuantity")}
              </th>
              <th scope="col" className={`${thClass} w-28 text-right`}>
                {t("owner.colUnitCost")}
              </th>
              <th scope="col" className={`${thClass} w-24 text-right`}>
                {t("owner.colCost")}
              </th>
              <th scope="col" className={`${thClass} w-14`}>
                <span className="sr-only">{t("owner.colActions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {parsed.length === 0 && (
              <tr>
                <td colSpan={5} className={`${tdClass} text-ink-muted`}>
                  {t("owner.recipeEmpty")}
                </td>
              </tr>
            )}
            {parsed.map((line, index) => {
              const { ingredient } = line;
              const zero = isZeroCost(ingredient.avgCost);
              const valid = line.milli !== null && line.milli > 0;
              return (
                <tr
                  key={line.ingredientId}
                  className={cn(zero && "bg-info-soft")}
                >
                  <th scope="row" className={`${tdClass} font-semibold`}>
                    {ingredient.name}
                    {!ingredient.isActive && (
                      <span className="ml-2 text-caption font-normal text-ink-muted">
                        {t("owner.inactive")}
                      </span>
                    )}
                  </th>
                  <td className={tdClass}>
                    <label className="flex items-center justify-end gap-1.5">
                      <span className="sr-only">
                        {t("owner.quantityOf", { name: ingredient.name })}
                      </span>
                      <input
                        inputMode="decimal"
                        value={line.qty}
                        aria-invalid={!valid || undefined}
                        onChange={(event) => {
                          setSavedNotice(false);
                          setLines((current) =>
                            current.map((row, i) =>
                              i === index
                                ? { ...row, qty: event.target.value }
                                : row,
                            ),
                          );
                        }}
                        className={cn(
                          "focus-ring h-10 w-18 rounded-control border bg-surface px-2 text-right tabular-nums",
                          valid ? "border-line" : "border-2 border-danger",
                        )}
                      />
                      <span className="w-7 text-ink-muted">
                        {ingredient.unit}
                      </span>
                    </label>
                  </td>
                  <td className={`${tdClass} text-right tabular-nums`}>
                    {zero ? "—" : formatUnitCost(ingredient.avgCost)}
                  </td>
                  <td className={`${tdClass} text-right tabular-nums`}>
                    {zero || !valid
                      ? "—"
                      : formatRupiah(
                          lineCost({
                            quantityMilli: line.milli!,
                            avgCost: ingredient.avgCost,
                          }),
                        )}
                  </td>
                  <td className={tdClass}>
                    <button
                      type="button"
                      aria-label={t("owner.removeIngredient", {
                        name: ingredient.name,
                      })}
                      onClick={() => {
                        setSavedNotice(false);
                        setLines((current) =>
                          current.filter((_, i) => i !== index),
                        );
                      }}
                      className="focus-ring flex size-10 cursor-pointer items-center justify-center rounded-card text-ink active:bg-accent-soft"
                    >
                      <Trash2 aria-hidden="true" size={18} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={add}
        noValidate
        className="flex flex-wrap items-start gap-3"
      >
        <SelectField
          label={t("owner.addIngredientToRecipe")}
          value={adding.ingredientId}
          options={[
            { value: "", label: t("owner.pickIngredient") },
            ...available.map((i) => ({
              value: i.id,
              label: `${i.name} (${i.unit})`,
            })),
          ]}
          onChange={(event) =>
            setAdding((current) => ({
              ...current,
              ingredientId: event.target.value,
            }))
          }
          className="min-w-48 flex-1"
        />
        <TextField
          label={t("owner.colQuantity")}
          inputMode="decimal"
          suffix={addingUnit}
          value={adding.qty}
          error={addError}
          onChange={(event) =>
            setAdding((current) => ({ ...current, qty: event.target.value }))
          }
          className="w-32"
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={!adding.ingredientId}
          icon={<Plus aria-hidden="true" />}
          className="mt-6"
        >
          {t("owner.addLine")}
        </Button>
      </form>

      {noCost.map((line) => (
        <div
          key={line.ingredientId}
          className="flex gap-3 rounded-card bg-info-soft px-4 py-3"
        >
          <Info aria-hidden="true" size={20} className="mt-0.5 text-info" />
          <div>
            <p className="text-owner-body font-semibold text-ink">
              {t("owner.noCostTitle", { name: line.ingredient.name })}
            </p>
            <p className="text-caption text-ink-muted">
              {t("owner.noCostBody")}
            </p>
          </div>
        </div>
      ))}

      <div className="flex-1" />
      <Button
        type="button"
        loading={busy}
        disabled={!changed || invalid}
        icon={<Check aria-hidden="true" />}
        onClick={() => void save()}
        className="w-full"
      >
        {t("owner.saveRecipe")}
      </Button>
    </div>
  );
}
