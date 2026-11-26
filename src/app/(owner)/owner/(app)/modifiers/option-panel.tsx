"use client";

import { Check, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/button";
import { SelectField, TextField } from "@/components/field";
import { Modal } from "@/components/modal";
import { t } from "@/i18n";
import { api } from "@/lib/api-client";
import { parsePriceDeltaInput } from "@/lib/money";
import {
  fromMilli,
  parseSignedQuantityInput,
  quantityInputText,
  toMilli,
} from "@/lib/quantity";
import type {
  IngredientData,
  ModifierGroupData,
  ModifierOptionData,
} from "../owner-queries";
import { Notice, SwitchRow, useSignedOutGuard } from "../owner-ui";

const rupiahDigits = new Intl.NumberFormat("id-ID");

type DeltaRow = { key: number; ingredientId: string; qty: string };

// O-04 option editor: name, price change, default, active, and what one
// serving uses more or less of (FR-IV-02: "extra shot = +9 g beans"). Only
// changed fields are sent; the deltas are replaced as a set. The server
// refuses a change that would let any item's price go below zero.
export function OptionPanel({
  group,
  option,
  ingredients,
  onSaved,
  onClose,
}: {
  group: ModifierGroupData;
  option: ModifierOptionData | null;
  ingredients: IngredientData[];
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const signedOut = useSignedOutGuard();
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const [name, setName] = useState(option?.name ?? "");
  const [price, setPrice] = useState(
    option && option.priceDelta !== 0
      ? `${option.priceDelta < 0 ? "-" : ""}${rupiahDigits.format(Math.abs(option.priceDelta))}`
      : "0",
  );
  const [isDefault, setIsDefault] = useState(option?.isDefault ?? false);
  const [isActive, setIsActive] = useState(option?.isActive ?? true);
  const [rows, setRows] = useState<DeltaRow[]>(() =>
    (option?.ingredientDeltas ?? []).map((delta, key) => ({
      key,
      ingredientId: delta.ingredientId,
      qty: quantityInputText(toMilli(delta.qtyDelta)),
    })),
  );
  const [nextKey, setNextKey] = useState(rows.length);
  const [errors, setErrors] = useState<{
    name?: string;
    price?: string;
    rows?: Record<number, string>;
  }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setRow = (key: number, patch: Partial<DeltaRow>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );

  async function submit(event: FormEvent) {
    event.preventDefault();
    const priceDelta = parsePriceDeltaInput(price);
    const next: typeof errors = {};
    if (!name.trim()) next.name = t("owner.nameRequired");
    if (priceDelta === null || Math.abs(priceDelta) > 10_000_000) {
      next.price = t("owner.priceDeltaInvalid");
    }
    const rowErrors: Record<number, string> = {};
    const deltas = rows.flatMap((row) => {
      if (!row.ingredientId) {
        rowErrors[row.key] = t("owner.pickIngredient");
        return [];
      }
      const milli = parseSignedQuantityInput(row.qty);
      if (!milli) {
        rowErrors[row.key] = t("owner.deltaInvalid");
        return [];
      }
      return [{ ingredientId: row.ingredientId, qtyDelta: fromMilli(milli) }];
    });
    if (Object.keys(rowErrors).length > 0) next.rows = rowErrors;
    setErrors(next);
    if (Object.keys(next).length > 0 || priceDelta === null) return;

    const values = {
      name: name.trim(),
      priceDelta,
      isDefault,
      isActive,
    };
    let body: Record<string, unknown>;
    if (option) {
      body = Object.fromEntries(
        Object.entries(values).filter(
          ([key, value]) => value !== option[key as keyof typeof values],
        ),
      );
      const key = (list: { ingredientId: string; qtyDelta: string }[]) =>
        list
          .map((d) => `${d.ingredientId}:${fromMilli(toMilli(d.qtyDelta))}`)
          .sort()
          .join();
      if (key(deltas) !== key(option.ingredientDeltas)) {
        body.ingredientDeltas = deltas;
      }
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
    } else {
      body = { ...values, ingredientDeltas: deltas };
    }

    setBusy(true);
    setFailure(null);
    const result = option
      ? await api(`/api/owner/modifier-options/${option.id}`, {
          method: "PATCH",
          body,
        })
      : await api(`/api/owner/modifier-groups/${group.id}/options`, {
          method: "POST",
          body,
        });
    if (signedOut(result)) return;
    if (!result.ok) {
      setBusy(false);
      setFailure(result.error.message);
      return;
    }
    await onSaved();
    onClose();
  }

  const chosen = new Set(rows.map((row) => row.ingredientId));

  return (
    <Modal
      placement="drawer"
      title={option ? t("owner.editOptionTitle") : t("owner.addOption")}
      description={group.name}
      onClose={onClose}
    >
      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-4 px-6 pt-4 pb-6"
      >
        {failure && <Notice tone="danger">{failure}</Notice>}
        <TextField
          label={t("owner.optionName")}
          value={name}
          maxLength={60}
          required
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label={t("owner.colPriceDelta")}
          prefix="Rp"
          inputMode="text"
          value={price}
          error={errors.price}
          helper={t("owner.priceDeltaHelp")}
          onChange={(event) => setPrice(event.target.value)}
        />
        <SwitchRow
          label={t("owner.optionDefault")}
          help={
            group.maxSelect === 1
              ? t("owner.optionDefaultSingleHelp")
              : t("owner.optionDefaultHelp")
          }
          checked={isDefault}
          onChange={setIsDefault}
        />
        <SwitchRow
          label={t("owner.optionActiveLabel")}
          help={t("owner.optionActiveHelp")}
          checked={isActive}
          onChange={setIsActive}
        />

        <fieldset className="flex flex-col gap-3 rounded-card border border-line p-4">
          <legend className="px-1 text-owner-body font-semibold text-ink">
            {t("owner.colStockEffect")}
          </legend>
          <p className="-mt-1 text-caption text-ink-muted">
            {t("owner.deltaHelp")}
          </p>
          {rows.map((row) => {
            const unit = byId.get(row.ingredientId)?.unit;
            return (
              <div key={row.key} className="flex flex-wrap items-start gap-2">
                <SelectField
                  label={t("owner.colIngredient")}
                  value={row.ingredientId}
                  options={[
                    { value: "", label: t("owner.pickIngredient") },
                    ...ingredients
                      .filter(
                        (i) =>
                          i.id === row.ingredientId ||
                          (i.isActive && !chosen.has(i.id)),
                      )
                      .map((i) => ({
                        value: i.id,
                        label: `${i.name} (${i.unit})`,
                      })),
                  ]}
                  onChange={(event) =>
                    setRow(row.key, { ingredientId: event.target.value })
                  }
                  className="min-w-44 flex-1"
                />
                <TextField
                  label={t("owner.colQuantity")}
                  inputMode="text"
                  suffix={unit}
                  value={row.qty}
                  error={errors.rows?.[row.key]}
                  onChange={(event) =>
                    setRow(row.key, { qty: event.target.value })
                  }
                  className="w-32"
                />
                <button
                  type="button"
                  aria-label={t("owner.removeDelta")}
                  onClick={() =>
                    setRows((current) =>
                      current.filter((other) => other.key !== row.key),
                    )
                  }
                  className="focus-ring mt-6 flex size-12 cursor-pointer items-center justify-center rounded-card text-ink active:bg-accent-soft"
                >
                  <Trash2 aria-hidden="true" size={18} />
                </button>
              </div>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            icon={<Plus aria-hidden="true" />}
            onClick={() => {
              setRows((current) => [
                ...current,
                { key: nextKey, ingredientId: "", qty: "" },
              ]);
              setNextKey((key) => key + 1);
            }}
            className="self-start"
          >
            {t("owner.addDelta")}
          </Button>
        </fieldset>

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
