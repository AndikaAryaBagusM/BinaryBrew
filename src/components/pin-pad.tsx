"use client";

import { ChevronLeft } from "lucide-react";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";

// PIN pad skeleton (Design §5; Figma "PIN pad" 6:308, "PIN dots" 6:307):
// 3×4 keys of 80×72 px, one dot per digit, a single shake on error. It only
// collects digits; checking the PIN belongs to the auth module (P1-01).
//
// Flow: when the last digit is entered the pad calls onComplete and waits.
// If the PIN was wrong, set `error`; the next key press starts a new entry.
// Set `error` back to false when onComplete fires again.
export type PinPadProps = {
  onComplete: (pin: string) => void;
  length?: number;
  error?: boolean;
  disabled?: boolean;
  message?: ReactNode;
  className?: string;
};

const keyClass =
  "focus-ring flex h-18 w-20 cursor-pointer items-center justify-center rounded-key border border-line bg-surface transition-colors duration-100 active:border-brand active:bg-accent-soft active:ring-1 active:ring-brand active:ring-inset disabled:cursor-not-allowed disabled:opacity-40";

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

export function PinPad({
  onComplete,
  length = 4,
  error = false,
  disabled = false,
  message,
  className,
}: PinPadProps) {
  const [digits, setDigits] = useState("");
  const submitted = digits.length === length;
  const showError = error && submitted;

  function press(digit: string) {
    if (disabled) return;
    if (submitted && !error) return; // waiting for the PIN check
    const next = submitted ? digit : digits + digit;
    setDigits(next);
    if (next.length === length) onComplete(next);
  }

  function remove() {
    if (disabled || digits.length === 0) return;
    if (submitted && !error) return;
    setDigits(submitted ? "" : digits.slice(0, -1));
  }

  // A physical keyboard works too, unless the user is typing in a field.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      press(event.key);
    } else if (event.key === "Backspace") {
      event.preventDefault();
      remove();
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      role="group"
      aria-label={t("pin.keypad")}
      className={cn("flex flex-col items-center gap-4", className)}
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex gap-4 py-2",
          showError && "motion-safe:animate-shake",
        )}
      >
        {Array.from({ length }, (_, index) => {
          const state = showError
            ? "error"
            : index < digits.length
              ? "filled"
              : "empty";
          return (
            <span
              key={index}
              data-dot={state}
              className={cn(
                "size-4.5 rounded-full",
                state === "error" && "bg-danger",
                state === "filled" && "bg-brand",
                state === "empty" && "border-2 border-border-strong",
              )}
            />
          );
        })}
      </div>
      <p className="sr-only" aria-live="polite">
        {t("pin.progress", { entered: digits.length, total: length })}
      </p>
      <div
        aria-live="assertive"
        className="min-h-6 text-center text-body font-medium text-danger"
      >
        {message}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <button
            key={digit}
            type="button"
            aria-label={digit}
            disabled={disabled}
            onClick={() => press(digit)}
            className={cn(
              keyClass,
              "text-counter-number text-ink tabular-nums",
            )}
          >
            {digit}
          </button>
        ))}
        <span aria-hidden="true" />
        <button
          type="button"
          aria-label="0"
          disabled={disabled}
          onClick={() => press("0")}
          className={cn(keyClass, "text-counter-number text-ink tabular-nums")}
        >
          0
        </button>
        <button
          type="button"
          aria-label={t("pin.delete")}
          disabled={disabled}
          onClick={remove}
          className={cn(
            keyClass,
            "gap-0.5 text-caption font-medium tracking-[0.2px] text-ink-muted",
          )}
        >
          <ChevronLeft aria-hidden="true" size={28} className="text-ink" />
          {t("pin.delete")}
        </button>
      </div>
    </div>
  );
}
