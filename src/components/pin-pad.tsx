"use client";

import { ChevronLeft, CircleAlert } from "lucide-react";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";

// PIN pad (Design §5; Figma "PIN pad" 6:308, "PIN dots" 6:307): 3×4 keys of
// 80×72 px, a single shake on error. PINs are 4–6 digits (PRD A4) and the
// pad never knows a user's PIN length: it shows 4 dots, one more per extra
// digit, and "Masuk" (bottom-left slot) submits once 4 digits are in; the
// 6th digit submits by itself. Checking the PIN belongs to the auth module.
//
// Flow: on submit the pad calls onComplete and waits. If the PIN was wrong,
// set `error`; the next key press starts a new entry. Set `error` back to
// false when onComplete fires again.
export const PIN_MIN = 4;
export const PIN_MAX = 6;

export type PinPadProps = {
  onComplete: (pin: string) => void;
  error?: boolean;
  disabled?: boolean;
  message?: ReactNode; // error text, shown with an alert icon
  hint?: ReactNode; // shown when there is no message
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
  error = false,
  disabled = false,
  message,
  hint,
  className,
}: PinPadProps) {
  const [digits, setDigits] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const showError = error && submitted;
  const waiting = submitted && !error; // the PIN is being checked

  function submit(pin: string) {
    setSubmitted(true);
    onComplete(pin);
  }

  function press(digit: string) {
    if (disabled || waiting) return;
    const next = submitted ? digit : digits + digit;
    if (next.length > PIN_MAX) return;
    setDigits(next);
    setSubmitted(false);
    if (next.length === PIN_MAX) submit(next);
  }

  function remove() {
    if (disabled || waiting || digits.length === 0) return;
    setDigits(submitted ? "" : digits.slice(0, -1));
    setSubmitted(false);
  }

  const canSubmit = !disabled && !submitted && digits.length >= PIN_MIN;
  function enter() {
    if (canSubmit) submit(digits);
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
    } else if (event.key === "Enter") {
      event.preventDefault();
      enter();
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const dots = Math.max(PIN_MIN, digits.length);
  return (
    <div
      role="group"
      aria-label={t("pin.keypad")}
      className={cn("flex flex-col items-center gap-5", className)}
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex gap-4 py-2",
          showError && "motion-safe:animate-shake",
        )}
      >
        {Array.from({ length: dots }, (_, index) => {
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
        {t("pin.progress", { entered: digits.length })}
      </p>
      <div
        aria-live="assertive"
        className="flex min-h-7 items-center gap-2 text-center"
      >
        {message ? (
          <>
            <CircleAlert
              aria-hidden="true"
              size={20}
              className="shrink-0 text-danger"
            />
            <span className="text-counter-body text-danger">{message}</span>
          </>
        ) : (
          hint && <span className="text-body text-ink-muted">{hint}</span>
        )}
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
        <button
          type="button"
          aria-label={t("pin.submit")}
          disabled={!canSubmit}
          onClick={enter}
          className={cn(
            keyClass,
            "border-brand bg-brand text-counter-label text-on-brand active:bg-brand-pressed",
          )}
        >
          {t("pin.submit")}
        </button>
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
