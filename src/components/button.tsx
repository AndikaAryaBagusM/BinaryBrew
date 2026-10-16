import type { ButtonHTMLAttributes, ReactNode } from "react";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";

// Figma "Button" (4:188): one primary per screen; disabled = 40 % opacity;
// loading keeps the label (Design §8).
export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";
export type ButtonSize = "customer" | "counter";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
};

// data-pressed shows the pressed look without touching (used on /dev/components).
const variantClass: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-on-brand active:bg-brand-pressed data-pressed:bg-brand-pressed",
  secondary:
    "border-[1.5px] border-border-strong bg-surface text-brand active:bg-surface-sunken data-pressed:bg-surface-sunken",
  destructive:
    "bg-danger text-on-brand active:bg-danger-pressed data-pressed:bg-danger-pressed",
  ghost: "text-brand active:bg-accent-soft data-pressed:bg-accent-soft",
};

// Customer 48 px, Counter 60 px (Design §5).
const sizeClass: Record<ButtonSize, string> = {
  customer: "h-12 px-5 text-label [&_svg]:size-5",
  counter: "h-15 px-6 text-counter-label [&_svg]:size-6",
};

export function Button({
  type = "button",
  variant = "primary",
  size = "customer",
  loading = false,
  icon,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  const spinnerTone =
    variant === "primary" || variant === "destructive" ? "on-brand" : "brand";
  const spinnerSize = size === "counter" ? 24 : 20;

  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        // relative: keeps the absolutely positioned sr-only text inside the
        // button, so it cannot widen a scroll container or the page.
        "focus-ring relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-card whitespace-nowrap transition-colors duration-100",
        "disabled:cursor-not-allowed [&:disabled:not([aria-busy])]:opacity-40",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        // Decorative 1 KB SVG from the Figma file; no image optimisation needed.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/icons/spinner-${spinnerTone}-${spinnerSize}.svg`}
          width={spinnerSize}
          height={spinnerSize}
          alt=""
          className="motion-safe:animate-spin"
        />
      ) : (
        icon
      )}
      {children}
      {loading && <span className="sr-only">{t("common.loading")}</span>}
    </button>
  );
}
