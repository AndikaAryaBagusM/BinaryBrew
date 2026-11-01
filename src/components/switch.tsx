import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// Figma "Switch" (5:418 on, 5:420 off): 52 × 32, brand when on. Give it a
// name with aria-label or aria-labelledby.
export type SwitchProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "role" | "aria-checked" | "onChange"
> & {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
};

export function Switch({
  checked,
  onCheckedChange,
  onClick,
  className,
  ...props
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange?.(!checked);
      }}
      className={cn(
        "focus-ring relative h-8 w-13 shrink-0 cursor-pointer rounded-full transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "bg-brand" : "bg-border-strong",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-0.75 size-6.5 rounded-full bg-surface shadow-thumb transition-[left] duration-100",
          checked ? "left-5.75" : "left-0.75",
        )}
      />
    </button>
  );
}
