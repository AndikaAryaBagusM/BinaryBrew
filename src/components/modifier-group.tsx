"use client";

import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { formatPriceDelta } from "@/lib/money";
import type { PublicModifierGroup } from "@/modules/menu/service";

// Modifier group (Design §5): a radio list when exactly one choice is needed,
// otherwise checkboxes (a radio cannot be unselected), with the price change
// on the right. "Wajib pilih" marks required groups; `invalid` highlights one
// after Add was tapped without a valid choice. The Counter size (S-03, Figma
// 15:1139) shows each option as a large bordered card.
export type ModifierGroupProps = {
  group: PublicModifierGroup;
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  invalid?: boolean;
  size?: "customer" | "counter";
};

export function ModifierGroup({
  group,
  selected,
  onChange,
  invalid = false,
  size = "customer",
}: ModifierGroupProps) {
  const counter = size === "counter";
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
    <fieldset
      id={`grup-${group.id}`}
      className={cn("flex flex-col", counter && "gap-2")}
    >
      <legend
        className={cn(
          "flex w-full items-center justify-between gap-2",
          counter ? "pb-2" : "pb-1",
        )}
      >
        <span className={counter ? "text-h2 text-ink" : "text-label text-ink"}>
          {group.name}
        </span>
        <span
          className={cn(
            "text-caption",
            invalid
              ? "font-semibold text-danger"
              : counter && required
                ? "rounded-full bg-status-waiting-bg px-2 py-0.5 font-medium text-status-waiting-fg"
                : "text-ink-muted",
          )}
        >
          {required
            ? t("menu.required")
            : counter
              ? t("counter.optional", { n: group.maxSelect })
              : t("menu.chooseUpTo", { n: group.maxSelect })}
        </span>
      </legend>
      {group.options.map((option) => {
        const checked = selected.includes(option.id);
        return (
          <label
            key={option.id}
            className={cn(
              "flex cursor-pointer items-center gap-3 has-disabled:cursor-not-allowed has-disabled:opacity-40",
              counter
                ? cn(
                    "min-h-14 rounded-card border px-4 py-2 has-focus-visible:ring-2 has-focus-visible:ring-brand",
                    checked
                      ? "border-[1.5px] border-brand bg-accent-soft"
                      : "border-line bg-surface",
                  )
                : "min-h-12 border-b border-line py-2 last:border-b-0",
            )}
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
            <span
              className={cn(
                "flex-1 text-ink",
                counter && checked ? "text-label" : "text-body",
              )}
            >
              {option.name}
            </span>
            <span
              className={
                counter
                  ? "text-caption font-medium text-price"
                  : "text-body text-ink-muted"
              }
            >
              {formatPriceDelta(option.priceDelta)}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
