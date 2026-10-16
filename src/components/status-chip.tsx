import {
  Ban,
  Bell,
  Check,
  CircleCheck,
  Clock,
  Coffee,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { t, type MessageKey } from "@/i18n";
import { cn } from "@/lib/cn";

// Figma "Status chip" (4:263): always icon + text, never colour alone.
// Statuses are the order_status enum values from the database.
export type OrderChipStatus =
  | "awaiting_payment"
  | "paid"
  | "preparing"
  | "ready"
  | "completed"
  | "expired"
  | "voided";

const chips: Record<
  OrderChipStatus,
  { icon: LucideIcon; label: MessageKey; tone: string }
> = {
  awaiting_payment: {
    icon: Clock,
    label: "chip.awaiting",
    tone: "bg-status-waiting-bg text-status-waiting-fg",
  },
  paid: { icon: Bell, label: "chip.paid", tone: "bg-info-soft text-info" },
  preparing: {
    icon: Coffee,
    label: "chip.preparing",
    tone: "bg-status-preparing-bg text-status-preparing-fg",
  },
  ready: {
    icon: CircleCheck,
    label: "chip.ready",
    tone: "bg-status-ready-bg text-status-ready-fg",
  },
  completed: {
    icon: Check,
    label: "chip.completed",
    tone: "bg-surface-sunken text-ink-muted",
  },
  expired: {
    icon: Timer,
    label: "chip.expired",
    tone: "bg-status-expired-bg text-status-expired-fg",
  },
  voided: {
    icon: Ban,
    label: "chip.voided",
    tone: "bg-status-voided-bg text-status-voided-fg",
  },
};

const sizeClass = {
  s: "px-2.5 py-1 text-caption font-medium tracking-[0.2px]",
  l: "px-3.5 py-2 text-body font-semibold",
};

export function StatusChip({
  status,
  size = "s",
  className,
}: {
  status: OrderChipStatus;
  size?: "s" | "l";
  className?: string;
}) {
  const { icon: Icon, label, tone } = chips[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full whitespace-nowrap",
        tone,
        sizeClass[size],
        className,
      )}
    >
      <Icon aria-hidden="true" size={size === "l" ? 20 : 16} />
      {t(label)}
    </span>
  );
}
