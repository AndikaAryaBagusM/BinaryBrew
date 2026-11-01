"use client";

import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { formatPriceDelta } from "@/lib/money";
import type { PublicModifierGroup } from "@/modules/menu/service";

// Modifier group (Design §5): a radio list when exactly one choice is needed,
// otherwise checkboxes (a radio cannot be unselected), with the price change
// on the right. "Wajib pilih" marks required groups; `invalid` highlights one
// after Add was tapped without a valid choice.
export type ModifierGroupProps = {
  group: PublicModifierGroup;
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  invalid?: boolean;
};

export function ModifierGroup({
  group,
  selected,
  onChange,
  invalid = false,
}: ModifierGroupProps) {
  const single = group.minSelect === 1 && group.maxSelect === 1;
  const required = group.minSelect >= 1;
  const count = group.options.filter((o) => selected.includes(o.id)).length;

  function toggle(optionId: string, checked: boolean) {
    if (single) return onChange([optionId]);
    onChange(
      checked
        ? [...selected, optionId]
        : selected.filter((id) => id !== optionId),
    );
  }

  return (
    <fieldset id={`grup-${group.id}`} className="flex flex-col">
      <legend className="flex w-full items-baseline justify-between gap-2 pb-1">
        <span className="text-label text-ink">{group.name}</span>
        <span
          className={cn(
            "text-caption",
            invalid ? "font-semibold text-danger" : "text-ink-muted",
          )}
        >
          {required
            ? t("menu.required")
            : t("menu.chooseUpTo", { n: group.maxSelect })}
        </span>
      </legend>
      {group.options.map((option) => {
        const checked = selected.includes(option.id);
        return (
          <label
            key={option.id}
            className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-line py-2 last:border-b-0 has-disabled:cursor-not-allowed has-disabled:opacity-40"
          >
            <input
              type={single ? "radio" : "checkbox"}
              name={group.id}
              value={option.id}
              checked={checked}
              disabled={!single && !checked && count >= group.maxSelect}
              aria-invalid={invalid ? "true" : undefined}
              onChange={(event) => toggle(option.id, event.target.checked)}
              className="focus-ring size-5 shrink-0 accent-brand"
            />
            <span className="flex-1 text-body text-ink">{option.name}</span>
            <span className="text-body text-ink-muted">
              {formatPriceDelta(option.priceDelta)}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
