"use client";

import { CircleCheck, Plus } from "lucide-react";
import { Button } from "@/components/button";
import { Sheet } from "@/components/sheet";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { formatRupiah } from "@/lib/money";
import type { SuggestionData } from "@/lib/suggestions";

// C-04 Recommendation sheet (Figma 12:792 default, 12:883 item added; Design
// §7): after "Bayar", before the payment. Up to 2 cards with "Tambah"; the
// total follows the cart. "Lanjut bayar", the close button and Esc all go
// on to payment, so the sheet can never block checkout. The "other
// customers" line shows only for suggestions from real rules.
export function SuggestionSheet({
  suggestions,
  added,
  total,
  onAdd,
  onContinue,
}: {
  suggestions: readonly SuggestionData[];
  added: ReadonlySet<number>;
  total: number;
  onAdd: (suggestion: SuggestionData) => void;
  onContinue: () => void;
}) {
  const fromRules = suggestions.some((s) => s.source === "rule");
  return (
    <Sheet
      title={t("reco.title")}
      description={fromRules ? t("reco.description") : undefined}
      open
      onOpenChange={(open) => !open && onContinue()}
      actions={
        <>
          <div className="flex items-center justify-between pb-1">
            <span className="text-body text-ink-muted">
              {t("reco.totalNow")}
            </span>
            <span data-testid="reco-total" className="text-label text-ink">
              {formatRupiah(total)}
            </span>
          </div>
          <Button className="w-full" onClick={onContinue}>
            {added.size > 0
              ? t("reco.continueTotal", { total: formatRupiah(total) })
              : t("reco.continue")}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-3">
        {suggestions.map((suggestion) => {
          const isAdded = added.has(suggestion.eventId);
          return (
            <li
              key={suggestion.eventId}
              className={cn(
                "flex items-center gap-3 rounded-card p-3 transition-colors duration-100",
                isAdded ? "bg-success-soft" : "bg-bg",
              )}
            >
              <span
                aria-hidden="true"
                className="flex size-14 shrink-0 items-center justify-center rounded-control bg-accent-soft text-h2 text-brand"
              >
                {suggestion.name.trim().charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-label text-ink">{suggestion.name}</p>
                <p className="text-label text-price">
                  {formatRupiah(suggestion.price)}
                </p>
              </div>
              {isAdded ? (
                <p
                  role="status"
                  className="flex shrink-0 items-center gap-1.5 text-label text-success"
                >
                  <CircleCheck aria-hidden="true" size={20} />
                  {t("reco.added")}
                </p>
              ) : (
                <Button
                  variant="secondary"
                  icon={<Plus aria-hidden="true" />}
                  aria-label={t("menu.addItem", { name: suggestion.name })}
                  onClick={() => onAdd(suggestion)}
                >
                  {t("reco.add")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
