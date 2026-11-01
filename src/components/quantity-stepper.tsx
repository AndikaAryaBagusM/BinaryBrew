"use client";

import { Minus, Plus } from "lucide-react";
import { t } from "@/i18n";
import { MAX_QUANTITY } from "@/modules/orders/pricing";

// Quantity stepper (Design §5): − / count / +, 44 px targets, 1 to 20.
export type QuantityStepperProps = {
  value: number;
  onChange: (value: number) => void;
  label?: string;
};

const buttonClass =
  "focus-ring flex size-11 cursor-pointer items-center justify-center rounded-full border-[1.5px] border-border-strong bg-surface text-brand transition-colors duration-100 active:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40";

export function QuantityStepper({
  value,
  onChange,
  label,
}: QuantityStepperProps) {
  return (
    <div
      role="group"
      aria-label={label ?? t("common.quantity")}
      className="flex items-center gap-2"
    >
      <button
        type="button"
        aria-label={t("common.decrease")}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
        className={buttonClass}
      >
        <Minus aria-hidden="true" size={20} />
      </button>
      <span
        aria-live="polite"
        className="min-w-7 text-center text-label text-ink"
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={t("common.increase")}
        disabled={value >= MAX_QUANTITY}
        onClick={() => onChange(value + 1)}
        className={buttonClass}
      >
        <Plus aria-hidden="true" size={20} />
      </button>
    </div>
  );
}
