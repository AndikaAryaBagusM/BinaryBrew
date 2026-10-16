"use client";

// Developer tool, not a user-facing screen: section headings and state names
// are English. Everything a customer or staff member would read comes from
// i18n so the components are shown with real copy.
import { useState, type ReactNode } from "react";
import { Button, type ButtonVariant } from "@/components/button";
import { PinPad } from "@/components/pin-pad";
import { Sheet } from "@/components/sheet";
import { StatusChip, type OrderChipStatus } from "@/components/status-chip";
import { t } from "@/i18n";
import { formatRupiah } from "@/lib/money";

const swatches = [
  ["bg", "bg-bg"],
  ["surface", "bg-surface"],
  ["surface-sunken", "bg-surface-sunken"],
  ["ink", "bg-ink"],
  ["ink-muted", "bg-ink-muted"],
  ["line", "bg-line"],
  ["border-strong", "bg-border-strong"],
  ["brand", "bg-brand"],
  ["brand-pressed", "bg-brand-pressed"],
  ["brand-dark", "bg-brand-dark"],
  ["accent", "bg-accent"],
  ["accent-soft", "bg-accent-soft"],
  ["caramel", "bg-caramel"],
  ["price", "bg-price"],
  ["danger", "bg-danger"],
  ["danger-pressed", "bg-danger-pressed"],
  ["danger-soft", "bg-danger-soft"],
  ["success", "bg-success"],
  ["success-soft", "bg-success-soft"],
  ["info", "bg-info"],
  ["info-soft", "bg-info-soft"],
  ["board-bg", "bg-board-bg"],
  ["board-tile", "bg-board-tile"],
  ["board-ready-tile", "bg-board-ready-tile"],
  ["board-preparing", "bg-board-preparing"],
  ["board-ready", "bg-board-ready"],
] as const;

const typeScale = [
  ["display", "text-display tabular-nums", "#014"],
  ["display-m", "text-display-m tabular-nums", "#014"],
  ["h1", "text-h1", t("reco.title")],
  ["h2", "text-h2", t("cart.title")],
  ["body", "text-body", t("pay.instruction")],
  ["label", "text-label", t("cart.payQris")],
  ["caption", "text-caption", t("cart.taxIncluded")],
  ["counter-title", "text-counter-title", t("board.preparing")],
  ["counter-number", "text-counter-number tabular-nums", "#014"],
  ["counter-body", "text-counter-body", t("counter.ownerPin")],
  ["counter-label", "text-counter-label", t("counter.start")],
  ["owner-body", "text-owner-body", t("owner.lowStock")],
  [
    "price (body)",
    "text-body font-semibold text-price tabular-nums",
    formatRupiah(22000),
  ],
] as const;

// Seed menu names (plan §7) for the sample recommendation sheet.
const suggestions = [
  { name: "Croissant", price: 18000 },
  { name: "Brownie", price: 15000 },
];

const variants: ButtonVariant[] = [
  "primary",
  "secondary",
  "destructive",
  "ghost",
];
const statuses: OrderChipStatus[] = [
  "awaiting_payment",
  "paid",
  "preparing",
  "ready",
  "completed",
  "expired",
  "voided",
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-card bg-surface p-4 shadow-card md:p-6">
      <h2 className="text-h2">{title}</h2>
      {children}
    </section>
  );
}

function StateLabel({ children }: { children: ReactNode }) {
  return <span className="text-caption text-ink-muted">{children}</span>;
}

const DEMO_PIN = "1234";
const MAX_ATTEMPTS = 5;

function PinDemo() {
  const [error, setError] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS);
  const [accepted, setAccepted] = useState(false);
  const [round, setRound] = useState(0); // remounts the pad to clear it
  const locked = attemptsLeft === 0;

  function check(pin: string) {
    setError(false);
    if (pin === DEMO_PIN) {
      setAccepted(true);
      return;
    }
    // Simulates the server check so the error and lockout states can be seen.
    setTimeout(() => {
      setError(true);
      setAttemptsLeft((left) => left - 1);
    }, 300);
  }

  const message = locked
    ? t("counter.locked", { minutes: 5 })
    : error
      ? t("counter.pinWrong", { n: attemptsLeft })
      : undefined;

  return (
    <div className="flex flex-col items-center gap-3">
      <PinPad
        key={round}
        onComplete={check}
        error={error}
        disabled={locked}
        message={message}
      />
      <StateLabel>
        Interactive: {DEMO_PIN} is accepted, anything else is wrong; 5 wrong
        tries lock the pad. Keyboard digits and Backspace work.
        {accepted && " Accepted."}
      </StateLabel>
      {(accepted || locked) && (
        <Button
          variant="ghost"
          onClick={() => {
            setAccepted(false);
            setError(false);
            setAttemptsLeft(MAX_ATTEMPTS);
            setRound((value) => value + 1);
          }}
        >
          Reset demo
        </Button>
      )}
    </div>
  );
}

export function Showcase() {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6 p-4 md:p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">Binary Brew components</h1>
        <p className="text-body text-ink-muted">
          Developer gallery (P0-05). Tokens from docs/04 §4 and Figma
          z0JS6kZeYkF6h1aB6BUDnT. Not available in production builds.
        </p>
      </header>

      <Section title="Colour tokens">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {swatches.map(([name, className]) => (
            <div key={name} className="flex flex-col gap-1">
              <div
                className={`h-12 rounded-control border border-line ${className}`}
              />
              <StateLabel>{name}</StateLabel>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type scale">
        <div className="flex flex-col gap-3">
          {typeScale.map(([name, className, sample]) => (
            <div key={name} className="flex flex-wrap items-baseline gap-4">
              <span className="w-32 shrink-0 text-caption text-ink-muted">
                {name}
              </span>
              <span className={className}>{sample}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Button: variant × size × state">
        {(["customer", "counter"] as const).map((size) => (
          <div key={size} className="flex flex-col gap-3">
            <h3 className="text-label">
              {size === "customer" ? "Customer (48 px)" : "Counter (60 px)"}
            </h3>
            <div className="grid min-w-0 grid-cols-[auto_repeat(4,max-content)] items-center gap-3 overflow-x-auto pb-1 lg:grid-cols-[auto_repeat(4,minmax(0,1fr))]">
              <span />
              {["Default", "Pressed", "Disabled", "Loading"].map((state) => (
                <StateLabel key={state}>{state}</StateLabel>
              ))}
              {variants.map((variant) => (
                <div key={variant} className="contents">
                  <StateLabel>{variant}</StateLabel>
                  <Button variant={variant} size={size}>
                    {size === "customer"
                      ? t("reco.continue")
                      : t("counter.start")}
                  </Button>
                  <Button variant={variant} size={size} data-pressed="">
                    {size === "customer"
                      ? t("reco.continue")
                      : t("counter.start")}
                  </Button>
                  <Button variant={variant} size={size} disabled>
                    {size === "customer"
                      ? t("reco.continue")
                      : t("counter.start")}
                  </Button>
                  <Button variant={variant} size={size} loading>
                    {size === "customer"
                      ? t("reco.continue")
                      : t("counter.start")}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>

      <Section title="Status chip: S and L">
        {(["s", "l"] as const).map((size) => (
          <div key={size} className="flex flex-wrap gap-3">
            {statuses.map((status) => (
              <StatusChip key={status} status={status} size={size} />
            ))}
          </div>
        ))}
      </Section>

      <Section title="Sheet">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setSheetOpen(true)}>Open sheet</Button>
          <StateLabel>
            Esc, the close button or the backdrop closes it; focus stays inside
            while open.
          </StateLabel>
        </div>
        <Sheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={t("reco.title")}
          actions={
            <Button className="w-full" onClick={() => setSheetOpen(false)}>
              {t("reco.continue")}
            </Button>
          }
        >
          <ul className="flex flex-col gap-3">
            {suggestions.map(({ name, price }) => (
              <li
                key={name}
                className="flex items-center justify-between gap-3 rounded-card border border-line p-3"
              >
                <div className="flex flex-col">
                  <span className="text-body font-semibold">{name}</span>
                  <span className="text-body text-price tabular-nums">
                    {formatRupiah(price)}
                  </span>
                </div>
                <Button variant="secondary">{t("reco.add")}</Button>
              </li>
            ))}
          </ul>
        </Sheet>
      </Section>

      <Section title="PIN pad">
        <div className="flex flex-wrap items-start justify-center gap-10">
          <PinDemo />
          <div className="flex flex-col items-center gap-3">
            <PinPad
              onComplete={() => {}}
              disabled
              message={t("counter.locked", { minutes: 5 })}
            />
            <StateLabel>Locked (disabled with the lockout message)</StateLabel>
          </div>
        </div>
      </Section>
    </main>
  );
}
