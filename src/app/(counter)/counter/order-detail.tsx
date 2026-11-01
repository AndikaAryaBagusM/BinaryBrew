"use client";

import { useQuery } from "@tanstack/react-query";
import { ReceiptText } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { StatusChip } from "@/components/status-chip";
import { t, type MessageKey } from "@/i18n";
import { cn } from "@/lib/cn";
import { nextStatus, type QueueStatus } from "@/lib/counter-queue";
import { formatRupiah } from "@/lib/money";
import { formatQueueNumber } from "@/lib/order-display";
import { formatTime } from "@/lib/time";
import { api, type OrderDetailData } from "./api";
import { counterOrderKey } from "./charge-dialog";

// S-06 Order detail (Figma 16:2468, Design §7, FR-POS-05): channel, payment,
// lines, total, the four status times, the next status step and the
// receipt. Void ("Batalkan pesanan") arrives in Phase 3.

const methodLabel: Record<
  NonNullable<OrderDetailData["payment"]>["method"],
  MessageKey
> = {
  qris_dynamic: "counter.methodDynamic",
  qris_static_manual: "counter.methodStatic",
  cash: "counter.methodCash",
};

const steps = [
  { key: "paidAt", label: "counter.stepPaid" },
  { key: "preparingAt", label: "counter.stepPreparing" },
  { key: "readyAt", label: "counter.stepReady" },
  { key: "completedAt", label: "counter.stepCollected" },
] as const satisfies readonly {
  key: keyof OrderDetailData;
  label: MessageKey;
}[];

const time = (iso: string | null) => (iso ? formatTime(new Date(iso)) : "—");
const isQueued = (status: string): status is QueueStatus =>
  status === "paid" || status === "preparing" || status === "ready";

export function OrderDetail({
  orderId,
  onAdvance,
  onClose,
  onSignedOut,
}: {
  orderId: string;
  onAdvance: (order: OrderDetailData) => Promise<void>;
  onClose: () => void;
  onSignedOut: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { data: order, error } = useQuery({
    queryKey: counterOrderKey(orderId),
    queryFn: async () => {
      const result = await api<OrderDetailData>(
        `/api/counter/orders/${orderId}`,
      );
      if (result.ok) return result.data;
      if (result.status === 401) onSignedOut();
      throw new Error(result.error.message);
    },
  });

  if (!order) {
    return (
      <Modal title={t("common.loading")} placement="drawer" onClose={onClose}>
        <p
          role={error ? "alert" : "status"}
          className="px-6 pt-4 text-body text-ink-muted"
        >
          {error ? error.message : t("common.loading")}
        </p>
      </Modal>
    );
  }

  const number =
    order.queueNumber === null ? null : formatQueueNumber(order.queueNumber);
  const channel =
    order.channel === "counter"
      ? t("counter.channelCounter", { name: order.createdByName ?? "" })
      : order.table
        ? t("counter.channelSelf", { table: order.table })
        : t("counter.channelSelfNoTable");

  async function advance() {
    setBusy(true);
    await onAdvance(order!);
    setBusy(false);
  }

  return (
    <Modal
      placement="drawer"
      onClose={onClose}
      title={
        <span className="flex items-center gap-3">
          <span className="text-counter-number tabular-nums">{number}</span>
          <StatusChip status={order.status} size="l" />
        </span>
      }
    >
      <div className="flex flex-1 flex-col gap-4 px-6 pt-4 pb-6">
        <dl className="flex flex-col gap-2 rounded-card bg-bg p-3 text-body">
          <Row label={t("counter.detailChannel")} value={channel} />
          {order.payment?.paidAt && (
            <Row
              label={t("counter.detailPaid")}
              value={`${time(order.payment.paidAt)} · ${t(methodLabel[order.payment.method])}`}
            />
          )}
          {order.payment?.reference && (
            <Row
              label={t("counter.detailRef")}
              value={order.payment.reference}
            />
          )}
        </dl>

        <ul className="flex flex-col gap-2">
          {order.items.map((item, index) => (
            <li key={index} className="flex gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-counter-body text-ink">
                  {item.quantity}× {item.name}
                </p>
                {item.options.length > 0 && (
                  <p className="text-body text-ink-muted">
                    {item.options.join(" · ")}
                  </p>
                )}
              </div>
              <p className="text-counter-body text-ink tabular-nums">
                {formatRupiah(item.lineTotal)}
              </p>
            </li>
          ))}
        </ul>
        <div className="flex border-t border-line pt-3 text-label text-ink">
          <span className="flex-1 font-normal text-ink-muted">
            {t("counter.total")}
          </span>
          <span className="tabular-nums">{formatRupiah(order.total)}</span>
        </div>

        <ol className="grid grid-cols-4 gap-2">
          {steps.map((step) => {
            const at = order[step.key];
            return (
              <li
                key={step.key}
                className={cn(
                  "flex flex-col rounded-card p-3",
                  at ? "bg-success-soft text-success" : "bg-bg text-ink-muted",
                )}
              >
                <span className="text-caption">{t(step.label)}</span>
                <span className="text-label tabular-nums">{time(at)}</span>
              </li>
            );
          })}
        </ol>

        {isQueued(order.status) && (
          <Button
            size="counter"
            variant={order.status === "ready" ? "secondary" : "primary"}
            loading={busy}
            onClick={() => void advance()}
          >
            {t(nextStatus(order.status).label)}
          </Button>
        )}
        <a
          href={`/s/${order.publicToken}/receipt`}
          target="_blank"
          rel="noopener"
          className="focus-ring flex h-15 items-center justify-center gap-2 rounded-card border-[1.5px] border-border-strong bg-surface px-6 text-counter-label text-brand active:bg-surface-sunken"
        >
          <ReceiptText aria-hidden="true" size={24} />
          {t("counter.viewReceipt")}
        </a>
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="flex-1 text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}
