"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheck,
  KeyRound,
  LoaderCircle,
  Lock,
  QrCode as QrIcon,
  Timer,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { PinPad } from "@/components/pin-pad";
import { QrCode } from "@/components/qr-code";
import { t } from "@/i18n";
import { useCurrentSecond } from "@/lib/clock";
import { formatRupiah } from "@/lib/money";
import { formatCountdown, formatQueueNumber } from "@/lib/order-display";
import { api, type OrderDetailData } from "./api";

// S-04 Charge (Figma 15:1276, 15:1368; Flow §5.3): the tablet shows the
// order's QRIS to the customer and moves on by itself once the payment
// arrives (counter SSE, plus a 3 s poll). "Pelanggan bayar lewat QR kios"
// opens S-05 (Figma 15:1517), and S-07 (15:1650) asks for the owner's PIN
// when the setting requires it (FR-PM-05, Flow §5.4, §8).

// POST /api/counter/orders, plus the line summary for the dialogs.
export type Charge = {
  id: string;
  publicToken: string;
  status: string;
  total: number;
  expiresAt: string;
  payment: {
    id: string;
    qrString: string | null;
    amount: number;
    expiresAt: string | null;
  } | null;
  summary: string;
};

type Step =
  | { kind: "qr" }
  | { kind: "manual"; reference: string; note: string }
  | { kind: "ownerPin"; reference: string; note: string };

const PAID_CLOSE_MS = 3_000;

export const counterOrderKey = (id: string) => ["counter-order", id];

export function ChargeDialog({
  charge,
  needsOwnerPin,
  mockPay,
  onPaid,
  onRetry,
  onClose,
  onSignedOut,
}: {
  charge: Charge;
  needsOwnerPin: boolean;
  mockPay: boolean;
  onPaid: () => void;
  onRetry: () => void;
  onClose: () => void;
  onSignedOut: () => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>({ kind: "qr" });
  const { data: order } = useQuery({
    queryKey: counterOrderKey(charge.id),
    queryFn: async () => {
      const result = await api<OrderDetailData>(
        `/api/counter/orders/${charge.id}`,
      );
      if (result.ok) return result.data;
      if (result.status === 401) onSignedOut();
      throw new Error(result.error.message);
    },
    refetchInterval: (query) =>
      query.state.data?.status === "awaiting_payment" ? 3_000 : false,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: counterOrderKey(charge.id) });

  const status = order?.status ?? charge.status;
  const paid = order?.queueNumber != null;

  // The walk-in cart is done once the order is paid; the dialog closes
  // itself after showing the number.
  const paidNow = useEffectEvent(onPaid);
  const closeNow = useEffectEvent(onClose);
  useEffect(() => {
    if (!paid) return;
    paidNow();
    const id = setTimeout(() => closeNow(), PAID_CLOSE_MS);
    return () => clearTimeout(id);
  }, [paid]);

  if (paid) {
    return <PaidView number={order!.queueNumber!} onClose={onClose} />;
  }
  if (status === "expired" || status === "voided") {
    return (
      <Modal title={t("pay.expired")} width="w-135" onClose={onClose}>
        <div className="flex flex-col gap-5 px-6 pt-2 pb-6">
          <p className="text-counter-body text-ink-muted">
            {t("counter.chargeExpired")}
          </p>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              size="counter"
              className="flex-1"
              onClick={onClose}
            >
              {t("common.close")}
            </Button>
            <Button size="counter" className="flex-1" onClick={onRetry}>
              {t("counter.newCharge")}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }
  if (step.kind === "manual") {
    return (
      <ManualPayment
        charge={charge}
        initial={step}
        needsOwnerPin={needsOwnerPin}
        onBack={() => setStep({ kind: "qr" })}
        onOwnerPin={(input) => setStep({ kind: "ownerPin", ...input })}
        onConfirmed={refresh}
        onSignedOut={onSignedOut}
      />
    );
  }
  if (step.kind === "ownerPin") {
    return (
      <OwnerPin
        charge={charge}
        input={step}
        onBack={() => setStep({ ...step, kind: "manual" })}
        onConfirmed={refresh}
        onSignedOut={onSignedOut}
      />
    );
  }
  return (
    <QrView
      charge={charge}
      mockPay={mockPay}
      onManual={() => setStep({ kind: "manual", reference: "", note: "" })}
      onCancelled={(next) => {
        if (next === "expired") onClose();
        else void refresh();
      }}
      onRefresh={refresh}
      onSignedOut={onSignedOut}
    />
  );
}

function QrView({
  charge,
  mockPay,
  onManual,
  onCancelled,
  onRefresh,
  onSignedOut,
}: {
  charge: Charge;
  mockPay: boolean;
  onManual: () => void;
  onCancelled: (status: string) => void;
  onRefresh: () => Promise<void>;
  onSignedOut: () => void;
}) {
  const second = useCurrentSecond();
  const [busy, setBusy] = useState<"cancel" | "pay" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const expiresAt = Date.parse(charge.payment?.expiresAt ?? charge.expiresAt);
  const remainingMs =
    second === null ? null : Math.max(0, expiresAt - second * 1000);

  async function cancel() {
    setBusy("cancel");
    setMessage(null);
    const result = await api<{ status: string }>(
      `/api/counter/orders/${charge.id}/cancel`,
      { method: "POST" },
    );
    setBusy(null);
    if (result.ok) return onCancelled(result.data.status);
    if (result.status === 401) return onSignedOut();
    setMessage(result.error.message);
  }

  async function simulatePaid() {
    if (!charge.payment) return;
    setBusy("pay");
    await api(`/api/dev/mock-pay/${charge.payment.id}`, { method: "POST" });
    await onRefresh();
    setBusy(null);
  }

  return (
    <Modal title={t("counter.chargeTitle")} hideTitle width="w-225">
      <div className="flex">
        <div className="flex w-[48%] flex-col items-center justify-center gap-4 rounded-l-[24px] bg-bg p-8">
          <span className="rounded-control border border-ink px-1.5 text-caption font-semibold text-ink">
            QRIS
          </span>
          <div className="w-full max-w-80 rounded-[16px] bg-surface p-4">
            {charge.payment?.qrString && (
              <QrCode
                value={charge.payment.qrString}
                label={t("pay.qrLabel")}
              />
            )}
          </div>
          <p className="text-body text-ink-muted">
            {t("counter.showCustomer")}
          </p>
        </div>
        <div className="flex flex-1 flex-col gap-3 p-8">
          <p aria-hidden="true" className="text-counter-title text-ink">
            {t("counter.chargeTitle")}
          </p>
          <div>
            <p className="text-body text-ink-muted">{t("counter.total")}</p>
            <p data-testid="charge-amount" className="text-display-m text-ink">
              {formatRupiah(charge.total)}
            </p>
            <p className="text-counter-body text-ink-muted">{charge.summary}</p>
          </div>
          <p
            role="timer"
            className="flex w-fit items-center gap-2 rounded-full bg-status-waiting-bg px-3 py-1.5 text-label text-status-waiting-fg tabular-nums"
          >
            <Timer aria-hidden="true" size={18} />
            {t("counter.validFor", {
              time:
                remainingMs === null ? "--:--" : formatCountdown(remainingMs),
            })}
          </p>
          <p
            role="status"
            className="flex items-center gap-2 text-body text-ink-muted"
          >
            <LoaderCircle
              aria-hidden="true"
              size={18}
              className="motion-safe:animate-spin"
            />
            {t("counter.waitingPayment")}
          </p>
          {message && (
            <p role="alert" className="text-body font-semibold text-danger">
              {message}
            </p>
          )}
          <div className="mt-auto flex flex-col gap-2 pt-3">
            <Button
              variant="secondary"
              size="counter"
              icon={<QrIcon aria-hidden="true" />}
              onClick={onManual}
            >
              {t("counter.paidStaticQr")}
            </Button>
            <Button
              variant="ghost"
              size="counter"
              loading={busy === "cancel"}
              onClick={() => void cancel()}
            >
              {t("counter.cancelCharge")}
            </Button>
            {mockPay && charge.payment && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void simulatePaid()}
                className="focus-ring flex h-12 cursor-pointer items-center justify-center gap-2 rounded-card border border-dashed border-info bg-info-soft text-label text-info disabled:opacity-40"
              >
                <Wallet aria-hidden="true" size={18} />
                {t("pay.mockPay")}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function PaidView({
  number,
  onClose,
}: {
  number: number;
  onClose: () => void;
}) {
  return (
    <Modal
      title={t("counter.paidTitle")}
      hideTitle
      width="w-140"
      onClose={onClose}
    >
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-success-soft">
          <CircleCheck aria-hidden="true" size={32} className="text-success" />
        </span>
        <p className="text-counter-title text-ink">{t("counter.paidTitle")}</p>
        <p data-testid="paid-number" className="text-display text-ink">
          {formatQueueNumber(number)}
        </p>
        <p className="text-counter-body text-ink">{t("counter.tellNumber")}</p>
        <p className="text-body text-ink-muted">
          {t("counter.paidAutoClose", { n: PAID_CLOSE_MS / 1000 })}
        </p>
        <Button size="counter" className="mt-2 w-full" onClick={onClose}>
          {t("counter.done")}
        </Button>
      </div>
    </Modal>
  );
}

type ManualInput = { reference: string; note: string };

// POST .../manual-payment; ELEVATION_REQUIRED sends the caller back to S-07.
async function confirmManual(
  orderId: string,
  input: ManualInput,
  elevationId?: string,
) {
  return api<{ status: string; queueNumber: number }>(
    `/api/counter/orders/${orderId}/manual-payment`,
    {
      method: "POST",
      body: {
        reference: input.reference.trim(),
        ...(input.note.trim() ? { note: input.note.trim() } : {}),
        ...(elevationId ? { elevationId } : {}),
      },
    },
  );
}

const inputClass =
  "focus-ring h-14 w-full rounded-control border-[1.5px] border-border-strong bg-surface px-4 text-counter-body text-ink placeholder:text-ink-muted";

function ManualPayment({
  charge,
  initial,
  needsOwnerPin,
  onBack,
  onOwnerPin,
  onConfirmed,
  onSignedOut,
}: {
  charge: Charge;
  initial: ManualInput;
  needsOwnerPin: boolean;
  onBack: () => void;
  onOwnerPin: (input: ManualInput) => void;
  onConfirmed: () => Promise<void>;
  onSignedOut: () => void;
}) {
  const [reference, setReference] = useState(initial.reference);
  const [note, setNote] = useState(initial.note);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function confirm() {
    if (!reference.trim()) {
      setMessage(t("counter.manualReferenceMissing"));
      document.getElementById("manual-reference")?.focus();
      return;
    }
    if (needsOwnerPin) return onOwnerPin({ reference, note });
    setSending(true);
    setMessage(null);
    const result = await confirmManual(charge.id, { reference, note });
    setSending(false);
    if (result.ok) return void (await onConfirmed());
    if (result.status === 401) return onSignedOut();
    if (result.error.code === "ELEVATION_REQUIRED") {
      return onOwnerPin({ reference, note });
    }
    setMessage(result.error.message);
    void onConfirmed();
  }

  return (
    <Modal title={t("counter.manualTitle")} width="w-155" onClose={onBack}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void confirm();
        }}
        className="flex flex-col gap-4 px-6 pt-4 pb-6"
      >
        <div className="flex gap-3 rounded-card bg-status-waiting-bg p-4 text-status-waiting-fg">
          <TriangleAlert aria-hidden="true" size={20} className="shrink-0" />
          <div>
            <p className="text-label">{t("counter.manualCheckTitle")}</p>
            <p className="text-caption">
              {t("counter.manualCheckBody", {
                amount: formatRupiah(charge.total),
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-card bg-bg p-4">
          <div className="min-w-0 flex-1">
            <p className="text-label text-ink">{t("counter.posTitle")}</p>
            <p className="truncate text-body text-ink-muted">
              {charge.summary}
            </p>
          </div>
          <p className="text-counter-title text-ink">
            {formatRupiah(charge.total)}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="manual-reference" className="text-label text-ink">
            {t("counter.manualReference")}
          </label>
          <input
            id="manual-reference"
            value={reference}
            maxLength={64}
            autoComplete="off"
            aria-describedby="manual-reference-hint"
            aria-invalid={
              message !== null && !reference.trim() ? true : undefined
            }
            onChange={(event) => setReference(event.target.value)}
            className={inputClass}
          />
          <p id="manual-reference-hint" className="text-caption text-ink-muted">
            {t("counter.manualReferenceHint")}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="manual-note" className="text-label text-ink">
            {t("counter.manualNote")}
          </label>
          <input
            id="manual-note"
            value={note}
            maxLength={200}
            autoComplete="off"
            placeholder={t("counter.manualNotePlaceholder")}
            onChange={(event) => setNote(event.target.value)}
            className={inputClass}
          />
        </div>
        {message && (
          <p role="alert" className="text-body font-semibold text-danger">
            {message}
          </p>
        )}
        <div className="flex gap-3">
          <Button variant="ghost" size="counter" onClick={onBack}>
            {t("counter.back")}
          </Button>
          <Button
            type="submit"
            size="counter"
            className="flex-1"
            loading={sending}
            icon={<KeyRound aria-hidden="true" />}
          >
            {t("counter.manualConfirm")}
          </Button>
        </div>
        <p className="flex items-center gap-1.5 text-caption text-ink-muted">
          <Lock aria-hidden="true" size={14} />
          {t(
            needsOwnerPin ? "counter.manualFooterPin" : "counter.manualFooter",
          )}
        </p>
      </form>
    </Modal>
  );
}

// S-07 (Flow §8): the owner's PIN makes a one-use elevation for this
// confirmation; a wrong PIN counts toward the owner's lockout.
function OwnerPin({
  charge,
  input,
  onBack,
  onConfirmed,
  onSignedOut,
}: {
  charge: Charge;
  input: ManualInput;
  onBack: () => void;
  onConfirmed: () => Promise<void>;
  onSignedOut: () => void;
}) {
  const [message, setMessage] = useState<string | null>(null);

  async function check(pin: string) {
    setMessage(null);
    const elevated = await api<{ elevationId: string }>("/api/auth/elevate", {
      method: "POST",
      body: { pin, scope: "manual_payment" },
    });
    if (!elevated.ok) {
      // A wrong PIN is also a 401; only a lost session signs out.
      const wrongPin = elevated.error.code === "INVALID_CREDENTIALS";
      if (elevated.status === 401 && !wrongPin) return onSignedOut();
      return setMessage(elevated.error.message);
    }
    const result = await confirmManual(
      charge.id,
      input,
      elevated.data.elevationId,
    );
    if (result.ok) return void (await onConfirmed());
    if (result.status === 401) return onSignedOut();
    setMessage(result.error.message);
    void onConfirmed();
  }

  return (
    <Modal
      title={t("counter.ownerPin")}
      description={t("counter.ownerPinFor", {
        amount: formatRupiah(charge.total),
      })}
      width="w-120"
      onClose={onBack}
    >
      <div className="flex flex-col items-center gap-4 px-6 pt-4 pb-6">
        <PinPad
          onComplete={(pin) => void check(pin)}
          error={message !== null}
          message={message ?? undefined}
        />
        <Button variant="ghost" size="counter" onClick={onBack}>
          {t("counter.back")}
        </Button>
      </div>
    </Modal>
  );
}
