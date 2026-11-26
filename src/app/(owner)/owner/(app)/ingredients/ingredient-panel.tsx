"use client";

import { Check } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/button";
import { SelectField, TextField } from "@/components/field";
import { Modal } from "@/components/modal";
import { t } from "@/i18n";
import { api } from "@/lib/api-client";
import {
  formatUnitCost,
  isZeroCost,
  parseRupiahInput,
  unitCostFromTotal,
} from "@/lib/money";
import {
  formatQuantity,
  fromMilli,
  parseQuantityInput,
  quantityInputText,
  toMilli,
} from "@/lib/quantity";
import { Notice, SwitchRow, useSignedOutGuard } from "../owner-ui";
import type { IngredientData } from "./ingredients-screen";
import { kindLabel } from "./labels";

type Draft = {
  name: string;
  kind: IngredientData["kind"];
  unit: IngredientData["unit"];
  minStockQty: string;
  isActive: boolean;
  openingQty: string;
  openingCost: string;
};

type Errors = Partial<Record<keyof Draft, string>>;

const MAX_OPENING_COST = 100_000_000;

// O-05 add / edit panel (FR-IV-01). Opening stock is asked only when the
// ingredient is created, together with what it cost, so the average cost
// starts right (docs/05 §3.5); after that stock changes only through the
// ledger. The unit locks once something counts in it. Only changed fields
// are sent; the server checks everything again and audits the change.
export function IngredientPanel({
  ingredient,
  onSaved,
  onClose,
}: {
  ingredient: IngredientData | null;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const signedOut = useSignedOutGuard();
  const [draft, setDraft] = useState<Draft>(() => ({
    name: ingredient?.name ?? "",
    kind: ingredient?.kind ?? "raw",
    unit: ingredient?.unit ?? "g",
    minStockQty: ingredient
      ? quantityInputText(toMilli(ingredient.minStockQty))
      : "0",
    isActive: ingredient?.isActive ?? true,
    openingQty: "",
    openingCost: "",
  }));
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const openingMilli = parseQuantityInput(draft.openingQty);
  const openingCost = parseRupiahInput(draft.openingCost);
  const preview =
    openingMilli && openingMilli > 0 && openingCost && openingCost > 0
      ? t("owner.openingPreview", {
          cost: formatUnitCost(unitCostFromTotal(openingCost, openingMilli)),
          unit: draft.unit,
        })
      : null;

  function validate() {
    const next: Errors = {};
    if (!draft.name.trim()) next.name = t("owner.nameRequired");
    if (parseQuantityInput(draft.minStockQty) === null) {
      next.minStockQty = t("owner.quantityInvalid");
    }
    if (!ingredient) {
      const hasQty = draft.openingQty.trim() !== "";
      const hasCost = draft.openingCost.trim() !== "";
      if (hasQty && (openingMilli === null || openingMilli <= 0)) {
        next.openingQty = t("owner.quantityInvalid");
      }
      if (
        hasCost &&
        (openingCost === null ||
          openingCost <= 0 ||
          openingCost > MAX_OPENING_COST)
      ) {
        next.openingCost = t("owner.totalCostInvalid");
      }
      if (hasQty !== hasCost) {
        next[hasQty ? "openingCost" : "openingQty"] ??= t("owner.openingBoth");
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!validate()) return;

    const values = {
      name: draft.name.trim(),
      kind: draft.kind,
      unit: draft.unit,
      minStockQty: fromMilli(parseQuantityInput(draft.minStockQty)!),
      isActive: draft.isActive,
    };
    let body: Record<string, unknown>;
    if (ingredient) {
      const current = {
        ...ingredient,
        minStockQty: fromMilli(toMilli(ingredient.minStockQty)),
      };
      body = Object.fromEntries(
        Object.entries(values).filter(
          ([key, value]) => value !== current[key as keyof typeof values],
        ),
      );
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
    } else {
      body = {
        ...values,
        opening:
          openingMilli && openingCost
            ? { quantity: fromMilli(openingMilli), totalCost: openingCost }
            : null,
      };
    }

    setBusy(true);
    setFailure(null);
    const result = ingredient
      ? await api(`/api/owner/ingredients/${ingredient.id}`, {
          method: "PATCH",
          body,
        })
      : await api("/api/owner/ingredients", { method: "POST", body });
    if (signedOut(result)) return;
    if (!result.ok) {
      setBusy(false);
      setFailure(result.error.message);
      return;
    }
    await onSaved();
    onClose();
  }

  return (
    <Modal
      placement="drawer"
      title={
        ingredient ? t("owner.editIngredientTitle") : t("owner.addIngredient")
      }
      onClose={onClose}
    >
      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-4 px-6 pt-4 pb-6"
      >
        {failure && <Notice tone="danger">{failure}</Notice>}
        <TextField
          label={t("owner.ingredientName")}
          value={draft.name}
          maxLength={60}
          required
          error={errors.name}
          onChange={(event) => set("name", event.target.value)}
        />
        <SelectField
          label={t("owner.colKind")}
          value={draft.kind}
          helper={t("owner.kindHelp")}
          options={(["raw", "resale"] as const).map((kind) => ({
            value: kind,
            label: t(kindLabel[kind]),
          }))}
          onChange={(event) => set("kind", event.target.value as Draft["kind"])}
        />
        <SelectField
          label={t("owner.colUnit")}
          value={draft.unit}
          disabled={ingredient?.unitLocked}
          helper={
            ingredient?.unitLocked ? t("owner.unitLockedHelp") : undefined
          }
          options={[
            { value: "g", label: t("owner.unitG") },
            { value: "ml", label: t("owner.unitMl") },
            { value: "pcs", label: t("owner.unitPcs") },
          ]}
          onChange={(event) => set("unit", event.target.value as Draft["unit"])}
        />
        <TextField
          label={t("owner.minStock")}
          inputMode="decimal"
          suffix={draft.unit}
          value={draft.minStockQty}
          required
          error={errors.minStockQty}
          helper={t("owner.minStockHelp")}
          onChange={(event) => set("minStockQty", event.target.value)}
        />

        {ingredient ? (
          <p className="text-caption text-ink-muted">
            {isZeroCost(ingredient.avgCost)
              ? t("owner.currentStockNoCost", {
                  qty: formatQuantity(toMilli(ingredient.stockQty)),
                  unit: ingredient.unit,
                })
              : t("owner.currentStock", {
                  qty: formatQuantity(toMilli(ingredient.stockQty)),
                  unit: ingredient.unit,
                  cost: formatUnitCost(ingredient.avgCost),
                })}
          </p>
        ) : (
          <fieldset className="flex flex-col gap-4 rounded-card border border-line p-4">
            <legend className="px-1 text-owner-body font-semibold text-ink">
              {t("owner.openingTitle")}
            </legend>
            <p className="-mt-2 text-caption text-ink-muted">
              {t("owner.openingHelp")}
            </p>
            <TextField
              label={t("owner.openingQty")}
              inputMode="decimal"
              suffix={draft.unit}
              value={draft.openingQty}
              error={errors.openingQty}
              onChange={(event) => set("openingQty", event.target.value)}
            />
            <TextField
              label={t("owner.openingCost")}
              prefix="Rp"
              inputMode="numeric"
              value={draft.openingCost}
              error={errors.openingCost}
              helper={preview}
              onChange={(event) => set("openingCost", event.target.value)}
            />
          </fieldset>
        )}

        <SwitchRow
          label={t("owner.ingredientActive")}
          help={t("owner.ingredientActiveHelp")}
          checked={draft.isActive}
          onChange={(value) => set("isActive", value)}
        />
        <Button
          type="submit"
          loading={busy}
          icon={<Check aria-hidden="true" />}
          className="mt-2 w-full"
        >
          {t("owner.save")}
        </Button>
      </form>
    </Modal>
  );
}
