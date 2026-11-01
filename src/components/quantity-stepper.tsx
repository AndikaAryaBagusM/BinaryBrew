"use client";

import { Minus, Plus } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { MAX_QUANTITY } from "@/modules/orders/pricing";

// Quantity stepper (Design §5; Figma "Quantity stepper" 5:196): − / count /
// +, up to 20. Customer: 44 px targets, 1 to 20. Counter: 56 px with a filled
// +; `min={0}` lets − take a cart line to zero (the caller removes it).
export type QuantityStepperProps = {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  size?: "customer" | "counter";
  min?: number;
  decreaseLabel?: string;
};

const buttonClass =
  "focus-ring flex shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40";
const outlined =
  "border-[1.5px] border-border-strong bg-surface text-brand active:bg-surface-sunken";

export function QuantityStepper({
  value,
  onChange,
  label,
  size = "customer",
  min = 1,
  decreaseLabel,
}: QuantityStepperProps) {
  const counter = size === "counter";
  const iconSize = counter ? 24 : 20;
  return (
    <div
      role="group"
      aria-label={label ?? t("common.quantity")}
      className={cn("flex items-center", counter ? "gap-1" : "gap-2")}
    >
      <button
        type="button"
        aria-label={decreaseLabel ?? t("common.decrease")}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        className={cn(buttonClass, outlined, counter ? "size-14" : "size-11")}
      >
        <Minus aria-hidden="true" size={iconSize} />
      </button>
      <span
        aria-live="polite"
        className={cn(
          "text-center text-ink tabular-nums",
          counter ? "w-12 text-counter-title" : "min-w-7 text-label",
        )}
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={t("common.increase")}
        disabled={value >= MAX_QUANTITY}
        onClick={() => onChange(value + 1)}
        className={cn(
          buttonClass,
          counter
            ? "size-14 bg-brand text-on-brand active:bg-brand-pressed"
            : cn(outlined, "size-11"),
        )}
      >
        <Plus aria-hidden="true" size={iconSize} />
      </button>
    </div>
  );
}
