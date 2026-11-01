import { Check } from "lucide-react";
import { t, type MessageKey } from "@/i18n";
import { cn } from "@/lib/cn";

// C-06 tracker (Design §7): Diterima → Disiapkan → Siap diambil. `step` is
// the current one (0–2), 3 when all are done; the current step carries
// aria-current, and the Ready step uses the Ready colours.
const steps: MessageKey[] = [
  "status.received",
  "status.preparing",
  "status.ready",
];

export function OrderTracker({ step }: { step: number }) {
  return (
    <ol aria-label={t("status.trackerLabel")} className="flex gap-2">
      {steps.map((label, index) => {
        const done = index < step;
        const current = index === step;
        const ready = index === 2 && (current || done);
        return (
          <li
            key={label}
            aria-current={current ? "step" : undefined}
            className="flex flex-1 flex-col items-center gap-1.5 text-center"
          >
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-full border-2 text-label",
                ready
                  ? "border-status-ready-fg bg-status-ready-bg text-status-ready-fg"
                  : done || current
                    ? "border-brand bg-brand text-on-brand"
                    : "border-line bg-surface text-ink-muted",
              )}
            >
              {done || (ready && current) ? (
                <Check aria-hidden="true" size={18} />
              ) : (
                index + 1
              )}
            </span>
            <span
              className={cn(
                "text-caption",
                current ? "font-semibold text-ink" : "text-ink-muted",
              )}
            >
              {t(label)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
