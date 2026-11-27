"use client";

import { Info, KeyRound, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/button";
import { SelectField, TextField } from "@/components/field";
import { Modal } from "@/components/modal";
import { PinPad } from "@/components/pin-pad";
import { t } from "@/i18n";
import { formatRupiah } from "@/lib/money";
import { formatQueueNumber } from "@/lib/order-display";
import {
  voidReasonLabel,
  voidReasons,
  type VoidReason,
} from "@/modules/orders/void-reasons";
import { api, type OrderDetailData } from "./api";

// S-06 void (Figma 16:2637) and S-07 (16:2792), P3-01, Flow §9: a reason
// (and a note; "Lainnya" needs one), then the owner's PIN, which makes a
// one-use elevation for this void. What happens to the stock and the money
// is said before anything is done (BR-08, FR-PM-08).

type Draft = { reason: VoidReason; note: string };

export function VoidDialog({
  order,
  onBack,
  onVoided,
  onSignedOut,
}: {
  order: OrderDetailData;
  onBack: () => void;
  onVoided: () => void;
  onSignedOut: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    reason: "changed_mind",
    note: "",
  });
  const [step, setStep] = useState<"reason" | "pin">("reason");
  const number = formatQueueNumber(order.queueNumber ?? 0);
  const refund =
    order.payment?.status === "paid" && order.payment.amount > 0
      ? order.payment.amount
      : null;

  if (step === "pin") {
    return (
      <VoidPin
        order={order}
        draft={draft}
        summary={
          refund === null
            ? t("counter.voidPinFor", { number })
            : t("counter.voidPinForRefund", {
                number,
                amount: formatRupiah(refund),
              })
        }
        onBack={() => setStep("reason")}
        onVoided={onVoided}
        onSignedOut={onSignedOut}
      />
    );
  }

  const prepared = order.status !== "paid";
  const noteMissing = draft.reason === "other" && !draft.note.trim();
  return (
    <Modal
      placement="drawer"
      title={t("counter.voidTitle", { number })}
      onClose={onBack}
    >
      <form
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 pt-4 pb-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (!noteMissing) setStep("pin");
        }}
      >
        <Callout
          tone="warning"
          title={t(
            prepared ? "counter.voidWasteTitle" : "counter.voidReturnTitle",
          )}
          body={t(
            prepared ? "counter.voidWasteBody" : "counter.voidReturnBody",
          )}
        />
        {refund !== null && (
          <Callout
            tone="info"
            title={t("counter.voidRefundTitle", {
              amount: formatRupiah(refund),
            })}
            body={t("counter.voidRefundBody")}
          />
        )}
        <SelectField
          label={t("counter.voidReason")}
          value={draft.reason}
          onChange={(event) =>
            setDraft({ ...draft, reason: event.target.value as VoidReason })
          }
          options={voidReasons.map((value) => ({
            value,
            label: t(voidReasonLabel[value]),
          }))}
        />
        <TextField
          label={t(
            draft.reason === "other"
              ? "counter.voidNoteRequired"
              : "counter.voidNote",
          )}
          placeholder={t("counter.voidNotePlaceholder")}
          maxLength={200}
          value={draft.note}
          required={draft.reason === "other"}
          onChange={(event) => setDraft({ ...draft, note: event.target.value })}
        />
        <div className="mt-auto flex flex-col gap-2 pt-4">
          <Button
            type="submit"
            size="counter"
            variant="destructive"
            disabled={noteMissing}
            icon={<KeyRound aria-hidden="true" />}
          >
            {t("counter.voidContinue")}
          </Button>
          <Button variant="ghost" size="counter" onClick={onBack}>
            {t("counter.voidBack")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Callout({
  tone,
  title,
  body,
}: {
  tone: "warning" | "info";
  title: string;
  body: string;
}) {
  const Icon = tone === "warning" ? TriangleAlert : Info;
  return (
    <div
      className={
        tone === "warning"
          ? "flex gap-3 rounded-card bg-status-waiting-bg p-4 text-status-waiting-fg"
          : "flex gap-3 rounded-card bg-info-soft p-4 text-info"
      }
    >
      <Icon aria-hidden="true" size={20} className="mt-0.5 shrink-0" />
      <div className="flex flex-col gap-1">
        <p className="text-label">{title}</p>
        <p className="text-body text-ink-muted">{body}</p>
      </div>
    </div>
  );
}

function VoidPin({
  order,
  draft,
  summary,
  onBack,
  onVoided,
  onSignedOut,
}: {
  order: OrderDetailData;
  draft: Draft;
  summary: string;
  onBack: () => void;
  onVoided: () => void;
  onSignedOut: () => void;
}) {
  const [message, setMessage] = useState<string | null>(null);

  async function check(pin: string) {
    setMessage(null);
    const elevated = await api<{ elevationId: string }>("/api/auth/elevate", {
      method: "POST",
      body: { pin, scope: "void_order" },
    });
    if (!elevated.ok) {
      // A wrong PIN is also a 401; only a lost session signs out.
      const wrongPin = elevated.error.code === "INVALID_CREDENTIALS";
      if (elevated.status === 401 && !wrongPin) return onSignedOut();
      return setMessage(elevated.error.message);
    }
    const note = draft.note.trim();
    const result = await api(`/api/counter/orders/${order.id}/void`, {
      method: "POST",
      body: {
        reason: draft.reason,
        ...(note ? { note } : {}),
        elevationId: elevated.data.elevationId,
      },
    });
    if (result.ok) return onVoided();
    if (result.status === 401) return onSignedOut();
    setMessage(result.error.message);
  }

  return (
    <Modal
      title={t("counter.ownerPin")}
      description={summary}
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
