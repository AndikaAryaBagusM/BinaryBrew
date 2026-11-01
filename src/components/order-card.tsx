import { Clock, Flame } from "lucide-react";
import { Button } from "@/components/button";
import { StatusChip } from "@/components/status-chip";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { nextStatus, type QueueStatus } from "@/lib/counter-queue";
import { formatQueueNumber } from "@/lib/order-display";

// Figma "Order card" (6:210), Counter queue: number, status, age, items and
// one primary action, the next status step (Design §6.2). New orders get a
// 3 px accent border for 5 s; "Paling lama" marks the oldest unfinished one.
// With onOpen, the rest of the card is one large target that opens S-06.
export type OrderCardProps = {
  queueNumber: number;
  status: QueueStatus;
  ageMinutes: number | null; // null until the clock is known (hydration)
  items: { name: string; quantity: number; options: string[] }[];
  isNew?: boolean;
  oldest?: boolean;
  busy?: boolean;
  onAdvance: () => void;
  onOpen?: () => void;
};

export function OrderCard({
  queueNumber,
  status,
  ageMinutes,
  items,
  isNew = false,
  oldest = false,
  busy = false,
  onAdvance,
  onOpen,
}: OrderCardProps) {
  const number = formatQueueNumber(queueNumber);
  const step = nextStatus(status);
  return (
    <article
      aria-label={t("counter.orderLabel", { number })}
      className={cn(
        "relative flex flex-col gap-3 rounded-[14px] bg-surface p-4 shadow-card",
        isNew ? "border-3 border-accent" : "border border-line",
      )}
    >
      {onOpen && (
        <button
          type="button"
          aria-label={t("counter.openDetail", { number })}
          onClick={onOpen}
          className="focus-ring absolute inset-0 cursor-pointer rounded-[14px]"
        />
      )}
      <div className="flex items-center gap-3">
        <p className="text-counter-number text-ink tabular-nums">{number}</p>
        <StatusChip status={status} size="l" />
        <span className="flex-1" />
        {ageMinutes !== null && (
          <p className="flex items-center gap-1.5 text-counter-body text-ink-muted">
            <Clock aria-hidden="true" size={18} />
            {ageMinutes === 0
              ? t("counter.ageJustNow")
              : t("counter.age", { n: ageMinutes })}
          </p>
        )}
      </div>
      {oldest && (
        <p className="flex w-fit items-center gap-1 rounded-full bg-danger-soft px-2 py-1 text-caption font-medium tracking-[0.2px] text-danger">
          <Flame aria-hidden="true" size={16} />
          {t("counter.oldest")}
        </p>
      )}
      <ul className="text-counter-body text-ink">
        {items.map((item, index) => (
          <li key={index}>
            {item.quantity}× {item.name}
            {item.options.length > 0 && (
              <span className="block pl-8">{item.options.join(" · ")}</span>
            )}
          </li>
        ))}
      </ul>
      <Button
        size="counter"
        variant={status === "ready" ? "secondary" : "primary"}
        className="relative w-full"
        disabled={busy}
        onClick={onAdvance}
      >
        {t(step.label)}
      </Button>
    </article>
  );
}
