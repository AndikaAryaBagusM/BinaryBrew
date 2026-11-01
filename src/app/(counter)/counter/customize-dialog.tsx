"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { ModifierGroup } from "@/components/modifier-group";
import { QuantityStepper } from "@/components/quantity-stepper";
import { t } from "@/i18n";
import { formatRupiah } from "@/lib/money";
import {
  type CartLine,
  previewLineTotal,
  selectionProblems,
} from "@/modules/orders/pricing";
import type { CounterMenuItemData } from "./api";

// S-03 POS customization (Figma 15:1139, Design §7): the same choices as C-02
// in a centred dialog with large targets, groups in two columns. Defaults are
// pre-selected; Add with a required group still empty highlights it.
export function CustomizeDialog({
  item,
  onClose,
  onAdd,
}: {
  item: CounterMenuItemData;
  onClose: () => void;
  onAdd: (line: CartLine) => void;
}) {
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
      document
        .querySelector<HTMLInputElement>(`#grup-${CSS.escape(first.id)} input`)
        ?.focus();
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
    <Modal title={item.name} width="w-205" onClose={onClose}>
      <p className="-mt-1 px-6 text-label text-price">
        {formatRupiah(item.price)}
      </p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 px-6 pt-5 pb-2">
        {item.modifierGroups.map((group) => (
          <ModifierGroup
            key={group.id}
            size="counter"
            group={group}
            selected={selected[group.id] ?? []}
            onChange={(ids) => choose(group.id, ids)}
            invalid={invalid.has(group.id)}
          />
        ))}
      </div>
      <div className="sticky bottom-0 flex items-center gap-4 bg-surface px-6 pt-3 pb-6">
        <QuantityStepper
          size="counter"
          value={quantity}
          onChange={setQuantity}
        />
        <Button size="counter" className="flex-1" onClick={add}>
          {t("counter.addToOrder", {
            price: formatRupiah(previewLineTotal(item, optionIds, quantity)),
          })}
        </Button>
      </div>
    </Modal>
  );
}
