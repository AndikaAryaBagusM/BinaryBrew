"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, KeyRound, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/button";
import { TextField } from "@/components/field";
import { Modal } from "@/components/modal";
import { PinPad } from "@/components/pin-pad";
import { t } from "@/i18n";
import { api, type ApiResult } from "@/lib/api-client";
import { formatRupiah } from "@/lib/money";
import { formatQueueNumber } from "@/lib/order-display";
import { formatDate, formatTime } from "@/lib/time";
import { Notice, useSignedOutGuard } from "../owner-ui";
import { Row } from "./order-card";
import {
  ORDERS_QUERY,
  REFUNDS_QUERY,
  type RefundData,
  refundReason,
} from "./shared";

// O-12 refund card (Figma 22:2301; P3-01, Schema §5.4 step 6): what was
// refunded and why, who voided it and whose PIN allowed it, what happened to
// the stock, and the steps to refund in the gateway dashboard. "Tandai sudah
// dikembalikan" asks for the gateway's refund id, then the owner's own PIN.

export function RefundTag({ status }: { status: "requested" | "processed" }) {
  const Icon = status === "requested" ? CircleAlert : CircleCheck;
  return (
    <span
      className={
        status === "requested"
          ? "inline-flex items-center gap-1 rounded-full bg-status-waiting-bg px-2.5 py-1 text-caption font-medium whitespace-nowrap text-status-waiting-fg"
          : "inline-flex items-center gap-1 rounded-full bg-status-ready-bg px-2.5 py-1 text-caption font-medium whitespace-nowrap text-status-ready-fg"
      }
    >
      <Icon aria-hidden="true" size={14} />
      {t(status === "requested" ? "owner.refundRequested" : "owner.refundDone")}
    </span>
  );
}

const when = (iso: string) => {
  const at = new Date(iso);
  return `${formatDate(at)}, ${formatTime(at)}`;
};

export function RefundCard({
  refund,
  onClose,
}: {
  refund: RefundData;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [gatewayRef, setGatewayRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const number =
    refund.queueNumber === null ? "—" : formatQueueNumber(refund.queueNumber);
  const amount = formatRupiah(refund.amount);

  const voidedBy =
    refund.source === "late_payment"
      ? t("owner.refundBySystem")
      : refund.approvedVoidBy &&
          refund.approvedVoidBy !== refund.requestedByName
        ? t("owner.refundVoidedApproved", {
            name: refund.requestedByName ?? "—",
            owner: refund.approvedVoidBy,
          })
        : t("owner.refundVoidedOwnPin", {
            name: refund.requestedByName ?? "—",
          });
  const stock = {
    returned: t("owner.refundStockReturned"),
    wasted: t("owner.refundStockWasted"),
    none: t("owner.refundStockNone"),
  }[refund.stock];

  async function done() {
    setPinOpen(false);
    setSaved(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: REFUNDS_QUERY }),
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY }),
      queryClient.invalidateQueries({ queryKey: ["owner", "order"] }),
    ]);
  }

  return (
    <section
      aria-label={t("owner.refundTitle", { number })}
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6"
    >
      <div className="flex items-start gap-3">
        <h2 className="flex flex-1 flex-wrap items-center gap-3 text-h2 text-ink">
          {t("owner.refundTitle", { number })}
          <RefundTag status={refund.status} />
        </h2>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={onClose}
          className="focus-ring flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-surface-sunken text-ink"
        >
          <X aria-hidden="true" size={20} />
        </button>
      </div>
      <dl className="flex flex-col gap-3 text-owner-body">
        <Row label={t("owner.refundAmount")}>{amount}</Row>
        <Row label={t("owner.refundReason")}>{refundReason(refund)}</Row>
        <Row label={t("owner.refundVoidedBy")}>{voidedBy}</Row>
        <Row label={t("owner.refundTime")}>{when(refund.createdAt)}</Row>
        <Row label={t("owner.refundPaymentRef")}>
          {refund.paymentRef ?? "—"}
        </Row>
        <Row label={t("owner.refundStock")}>{stock}</Row>
        {refund.status === "processed" && (
          <>
            <Row label={t("owner.refundGatewayRef")}>
              {refund.gatewayRef ?? "—"}
            </Row>
            <Row label={t("owner.refundProcessedBy")}>
              {refund.processedByName ?? "—"}
              {refund.processedAt && ` · ${when(refund.processedAt)}`}
            </Row>
          </>
        )}
      </dl>

      {saved && refund.status === "processed" && (
        <Notice tone="success">{t("owner.refundSaved", { number })}</Notice>
      )}

      {refund.status === "requested" && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!gatewayRef.trim()) {
              setError(t("owner.refundGatewayRefMissing"));
              return;
            }
            setError(null);
            setPinOpen(true);
          }}
        >
          <ol className="flex list-inside list-decimal flex-col gap-2 rounded-card bg-bg p-4 text-body text-ink">
            <li>
              {refund.paymentMethod === "qris_static_manual"
                ? t("owner.refundStepFindManual", {
                    ref: refund.paymentRef ?? "—",
                  })
                : t("owner.refundStepFind", { ref: refund.paymentRef ?? "—" })}
            </li>
            <li>{t("owner.refundStepPay", { amount })}</li>
            <li>{t("owner.refundStepMark")}</li>
          </ol>
          <TextField
            label={t("owner.refundGatewayRefField")}
            helper={t("owner.refundGatewayRefHelp")}
            error={error ?? undefined}
            maxLength={64}
            value={gatewayRef}
            onChange={(event) => setGatewayRef(event.target.value)}
          />
          <Button type="submit" icon={<KeyRound aria-hidden="true" />}>
            {t("owner.refundMark")}
          </Button>
          <p className="text-caption text-ink-muted">
            {t("owner.refundMarkHint")}
          </p>
        </form>
      )}

      {pinOpen && (
        <OwnerPin
          refundId={refund.id}
          gatewayRef={gatewayRef.trim()}
          summary={t("owner.refundPinFor", { number, amount })}
          onDone={() => void done()}
          onClose={() => setPinOpen(false)}
        />
      )}
    </section>
  );
}

// A wrong PIN (401) or a spent elevation (403) is said on the PIN pad; only
// a session that ended goes back to O-01.
const sessionEnded = (result: ApiResult<unknown>) =>
  !result.ok &&
  (result.error.code === "UNAUTHENTICATED" ||
    result.error.code === "FORBIDDEN");

function OwnerPin({
  refundId,
  gatewayRef,
  summary,
  onDone,
  onClose,
}: {
  refundId: string;
  gatewayRef: string;
  summary: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const signedOut = useSignedOutGuard();
  const [message, setMessage] = useState<string | null>(null);

  async function check(pin: string) {
    setMessage(null);
    const elevated = await api<{ elevationId: string }>("/api/auth/elevate", {
      method: "POST",
      body: { pin, scope: "refund_processed" },
    });
    if (!elevated.ok) {
      if (sessionEnded(elevated) && signedOut(elevated)) return;
      return setMessage(elevated.error.message);
    }
    const result = await api(`/api/owner/refunds/${refundId}/processed`, {
      method: "POST",
      body: { gatewayRef, elevationId: elevated.data.elevationId },
    });
    if (result.ok) return onDone();
    if (sessionEnded(result) && signedOut(result)) return;
    setMessage(result.error.message);
  }

  return (
    <Modal
      title={t("owner.refundPinTitle")}
      description={summary}
      width="w-120"
      onClose={onClose}
    >
      <div className="flex flex-col items-center gap-4 px-6 pt-4 pb-6">
        <PinPad
          onComplete={(pin) => void check(pin)}
          error={message !== null}
          message={message ?? undefined}
        />
        <Button variant="ghost" onClick={onClose}>
          {t("counter.back")}
        </Button>
      </div>
    </Modal>
  );
}
