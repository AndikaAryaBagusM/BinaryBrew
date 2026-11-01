"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { ModifierGroup } from "@/components/modifier-group";
import { QuantityStepper } from "@/components/quantity-stepper";
import { Sheet } from "@/components/sheet";
import { t } from "@/i18n";
import { formatRupiah } from "@/lib/money";
import type { PublicMenuItem } from "@/modules/menu/service";
import {
  type CartLine,
  previewLineTotal,
  selectionProblems,
} from "@/modules/orders/pricing";

// C-02 customization sheet (Design §7): groups in order with defaults
// pre-selected, a quantity stepper and "Tambah • Rp …" with the live price.
// Add with a required group still empty highlights that group instead.
export type CustomizeSheetProps = {
  item: PublicMenuItem;
  onOpenChange: (open: boolean) => void;
  onAdd: (line: CartLine) => void;
};

export function CustomizeSheet({
  item,
  onOpenChange,
  onAdd,
}: CustomizeSheetProps) {
  const [selected, setSelected] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      item.modifierGroups.map((group) => [
        group.id,
        group.options.filter((o) => o.isDefault).map((o) => o.id),
      ]),
    ),
  );
  const [quantity, setQuantity] = useState(1);
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());

  const optionIds = Object.values(selected).flat();

  function add() {
    const problems = selectionProblems(item, optionIds);
    if (problems.length === 0) {
      onAdd({ menuItemId: item.id, quantity, modifierOptionIds: optionIds });
      return;
    }
    const groups = new Set(
      problems.flatMap((p) => ("groupId" in p ? [p.groupId] : [])),
    );
    setInvalid(groups);
    const first = item.modifierGroups.find((group) => groups.has(group.id));
    if (first) {
      document.getElementById(`grup-${first.id}`)?.scrollIntoView({
        block: "center",
      });
      document
        .querySelector<HTMLInputElement>(`#grup-${CSS.escape(first.id)} input`)
        ?.focus({ preventScroll: true });
    }
  }

  function choose(groupId: string, ids: string[]) {
    setSelected((current) => ({ ...current, [groupId]: ids }));
    setInvalid((current) => {
      if (!current.has(groupId)) return current;
      const next = new Set(current);
      next.delete(groupId);
      return next;
    });
  }

  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      title={item.name}
      actions={
        <Button onClick={add} className="w-full">
          {t("menu.addToCart", {
            price: formatRupiah(previewLineTotal(item, optionIds, quantity)),
          })}
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <p className="text-label text-price">{formatRupiah(item.price)}</p>
          {item.description && (
            <p className="mt-1 text-body text-ink-muted">{item.description}</p>
          )}
        </div>
        {item.modifierGroups.map((group) => (
          <ModifierGroup
            key={group.id}
            group={group}
            selected={selected[group.id] ?? []}
            onChange={(ids) => choose(group.id, ids)}
            invalid={invalid.has(group.id)}
          />
        ))}
        <div className="flex items-center justify-between">
          <span className="text-label text-ink">{t("common.quantity")}</span>
          <QuantityStepper value={quantity} onChange={setQuantity} />
        </div>
      </div>
    </Sheet>
  );
}
