"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackagePlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/button";
import { SelectField, TextField } from "@/components/field";
import { Modal } from "@/components/modal";
import { t } from "@/i18n";
import { formatUnitCost, isZeroCost, parseRupiahInput } from "@/lib/money";
import { formatQuantity, fromMilli, parseQuantityInput } from "@/lib/quantity";
import { previewRestocks } from "@/modules/inventory/restock-preview";
import { MAX_RESTOCK_TOTAL } from "@/modules/inventory/schemas";
import type { RestockOptions } from "@/modules/inventory/service";
import { api, type Json } from "./api";

type OptionsData = Json<RestockOptions>;
type Errors = Partial<Record<"ingredient" | "quantity" | "total", string>>;

const OPTIONS_KEY = ["counter", "restock-options"] as const;

// S-09 Quick restock (Figma 16:3058, FR-IV-05): one delivery at a time. The
// preview shows the weighted-average cost the save will leave (Schema §5.5);
// the server recomputes it from the locked row and the confirmation shows
// the stored value. A restock can make stock-out items available again, so
// the Counter menu is refetched after a save.
export function RestockPanel({
  onSaved,
  onClose,
  onSignedOut,
}: {
  onSaved: () => Promise<void>;
  onClose: () => void;
  onSignedOut: () => void;
}) {
  const queryClient = useQueryClient();
  const [ingredientId, setIngredientId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [total, setTotal] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: options } = useQuery({
    queryKey: OPTIONS_KEY,
    queryFn: async () => {
      const result = await api<OptionsData>("/api/counter/restock-options");
      if (result.ok) return result.data;
      if (result.status === 401) onSignedOut();
      throw new Error(result.error.message);
    },
  });

  const ingredient = options?.ingredients.find(
    (row) => row.id === ingredientId,
  );
  const quantityMilli = parseQuantityInput(quantity);
  const totalCost = parseRupiahInput(total);
  const [preview] = options
    ? previewRestocks(options.ingredients, [
        { ingredientId: ingredientId || null, quantityMilli, totalCost },
      ])
    : [null];

  function validate() {
    const next: Errors = {};
    if (!ingredient) next.ingredient = t("counter.restockIngredientRequired");
    if (quantityMilli === null || quantityMilli <= 0) {
      next.quantity = t("owner.quantityInvalid");
    }
    if (totalCost === null || totalCost > MAX_RESTOCK_TOTAL) {
      next.total = t("owner.totalCostInvalid");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(null);
    if (!validate() || !ingredient) return;
    setBusy(true);
    setFailure(null);
    const result = await api<{ restocks: { avgCostAfter: string }[] }>(
      "/api/counter/restocks",
      {
        method: "POST",
        body: {
          lines: [
            {
              ingredientId: ingredient.id,
              quantity: fromMilli(quantityMilli!),
              totalCost: totalCost!,
              supplierId: supplierId || null,
            },
          ],
        },
      },
    );
    setBusy(false);
    if (!result.ok) {
      if (result.status === 401) return onSignedOut();
      setFailure(result.error.message);
      await queryClient.invalidateQueries({ queryKey: OPTIONS_KEY });
      return;
    }
    setSaved(
      t("counter.restockSaved", {
        name: ingredient.name,
        cost: formatUnitCost(result.data.restocks[0]!.avgCostAfter),
        unit: ingredient.unit,
      }),
    );
    setQuantity("");
    setTotal("");
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: OPTIONS_KEY }),
      onSaved(),
    ]);
  }

  const unit = ingredient?.unit ?? "";

  return (
    <Modal
      title={t("counter.restockTitle")}
      description={t("counter.restockHelp")}
      placement="drawer"
      onClose={onClose}
    >
      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-4 px-6 pt-4 pb-6"
      >
        {failure && (
          <p role="alert" className="text-body font-semibold text-danger">
            {failure}
          </p>
        )}
        {options && options.ingredients.length === 0 && (
          <p className="text-body text-ink-muted">
            {t("counter.restockEmpty")}
          </p>
        )}
        <SelectField
          label={t("counter.restockIngredient")}
          value={ingredientId}
          disabled={!options}
          error={errors.ingredient}
          options={[
            { value: "", label: t("counter.restockPickIngredient") },
            ...(options?.ingredients ?? []).map((row) => ({
              value: row.id,
              label: t("owner.restockIngredientOption", {
                name: row.name,
                unit: row.unit,
              }),
            })),
          ]}
          onChange={(event) => {
            setIngredientId(event.target.value);
            setSaved(null);
          }}
        />
        <TextField
          label={t("counter.restockQuantity")}
          inputMode="decimal"
          autoComplete="off"
          suffix={unit}
          value={quantity}
          error={errors.quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <TextField
          label={t("counter.restockTotal")}
          prefix="Rp"
          inputMode="numeric"
          autoComplete="off"
          value={total}
          error={errors.total}
          onChange={(event) => setTotal(event.target.value)}
        />
        <SelectField
          label={t("counter.restockSupplier")}
          value={supplierId}
          disabled={!options}
          options={[
            { value: "", label: t("counter.restockNoSupplier") },
            ...(options?.suppliers ?? []).map((row) => ({
              value: row.id,
              label: row.name,
            })),
          ]}
          onChange={(event) => setSupplierId(event.target.value)}
        />

        {preview && ingredient && (
          <div
            role="status"
            className="flex flex-col gap-1 rounded-card bg-info-soft px-4 py-3"
          >
            <p className="text-caption font-medium text-info">
              {t("counter.restockPreviewTitle")}
            </p>
            <p className="text-h1 text-ink">
              {t("owner.restockCost", {
                cost: formatUnitCost(preview.avgCostAfter),
                unit,
              })}
            </p>
            <p className="text-caption text-ink-muted">
              {isZeroCost(preview.avgCostBefore)
                ? t("counter.restockPreviewFirst", {
                    qty: formatQuantity(preview.stockMilliAfter),
                    unit,
                  })
                : t("counter.restockPreviewDetail", {
                    cost: formatUnitCost(preview.avgCostBefore),
                    qty: formatQuantity(preview.stockMilliAfter),
                    unit,
                  })}
            </p>
          </div>
        )}
        {saved && (
          <p
            role="status"
            className="rounded-card bg-success-soft px-4 py-3 text-body font-medium text-success"
          >
            {saved}
          </p>
        )}

        <Button
          type="submit"
          size="counter"
          loading={busy}
          disabled={!options}
          icon={<PackagePlus aria-hidden="true" />}
          className="mt-2 w-full"
        >
          {t("counter.restockSave")}
        </Button>
      </form>
    </Modal>
  );
}
