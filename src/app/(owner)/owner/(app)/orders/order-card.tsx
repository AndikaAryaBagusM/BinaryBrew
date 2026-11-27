"use client";

import { useQuery } from "@tanstack/react-query";
import { ReceiptText, X } from "lucide-react";
import type { ReactNode } from "react";
import { StatusChip } from "@/components/status-chip";
import { t, type MessageKey } from "@/i18n";
import { api, type Json } from "@/lib/api-client";
import { formatRupiah } from "@/lib/money";
import { formatQueueNumber } from "@/lib/order-display";
import { formatDate, formatTime } from "@/lib/time";
import type { getOwnerOrder } from "@/modules/orders/service";
import { useSignedOutGuard } from "../owner-ui";
import { RefundTag } from "./refund-card";
import { ORDER_QUERY } from "./shared";

export type OwnerOrderData = Json<Awaited<ReturnType<typeof getOwnerOrder>>>;

export const methodLabel: Record<
  NonNullable<OwnerOrderData["payment"]>["method"],
  MessageKey
> = {
  qris_dynamic: "counter.methodDynamic",
  qris_static_manual: "counter.methodStatic",
  cash: "counter.methodCash",
};

const clock = (iso: string | null) => (iso ? formatTime(new Date(iso)) : null);

// O-12 order card: what S-06 shows (channel, payment, lines, total, times),
// who voided it and why, its refunds and the receipt.
export function OrderCard({
  orderId,
  onOpenRefund,
  onClose,
}: {
  orderId: string;
  onOpenRefund: (refundId: string) => void;
  onClose: () => void;
}) {
  const signedOut = useSignedOutGuard();
  const { data: order, error } = useQuery({
    queryKey: ORDER_QUERY(orderId),
    queryFn: async () => {
      const result = await api<OwnerOrderData>(`/api/owner/orders/${orderId}`);
      if (signedOut(result)) return null;
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
  });

  const number =
    order?.queueNumber == null ? "—" : formatQueueNumber(order.queueNumber);
  return (
    <section
      aria-label={t("owner.orderCardTitle", { number })}
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6"
    >
      <div className="flex items-start gap-3">
        <h2 className="flex flex-1 flex-wrap items-center gap-3 text-h2 text-ink">
          {t("owner.orderCardTitle", { number })}
          {order && <StatusChip status={order.status} />}
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
      {!order ? (
        <p
          role={error ? "alert" : "status"}
          className="text-body text-ink-muted"
        >
          {error ? error.message : t("common.loading")}
        </p>
      ) : (
        <>
          <dl className="flex flex-col gap-3 text-owner-body">
            <Row label={t("counter.detailChannel")}>
              {order.channel === "counter"
                ? t("counter.channelCounter", {
                    name: order.createdByName ?? "",
                  })
                : order.table
                  ? t("counter.channelSelf", { table: order.table })
                  : t("counter.channelSelfNoTable")}
            </Row>
            <Row label={t("owner.orderCreated")}>
              {formatDate(new Date(order.createdAt))},{" "}
              {formatTime(new Date(order.createdAt))}
            </Row>
            {order.payment?.paidAt && (
              <Row label={t("counter.detailPaid")}>
                {clock(order.payment.paidAt)} ·{" "}
                {t(methodLabel[order.payment.method])}
              </Row>
            )}
            {order.payment?.reference && (
              <Row label={t("counter.detailRef")}>
                {order.payment.reference}
              </Row>
            )}
            {order.status === "voided" && (
              <>
                <Row label={t("owner.orderVoidedBy")}>
                  {order.voidedByName ?? "—"} · {clock(order.voidedAt)}
                </Row>
                <Row label={t("owner.refundReason")}>
                  {order.voidReason ?? "—"}
                </Row>
              </>
            )}
          </dl>

          {order.refunds.length > 0 && (
            <ul className="flex flex-col gap-2">
              {order.refunds.map((refund) => (
                <li
                  key={refund.id}
                  className="flex items-center gap-3 rounded-card bg-bg px-4 py-3 text-owner-body"
                >
                  <span className="flex-1">
                    {t("owner.orderRefundLine", {
                      amount: formatRupiah(refund.amount),
                    })}
                  </span>
                  <RefundTag status={refund.status} />
                  <button
                    type="button"
                    onClick={() => onOpenRefund(refund.id)}
                    className="focus-ring cursor-pointer rounded-sm font-semibold text-brand underline-offset-4 hover:underline"
                  >
                    {t("owner.orderSeeRefund")}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <ul className="flex flex-col gap-2 border-t border-line pt-4">
            {order.items.map((item, index) => (
              <li key={index} className="flex gap-3 text-owner-body">
                <div className="min-w-0 flex-1">
                  <p className="text-ink">
                    {item.quantity}× {item.name}
                  </p>
                  {item.options.length > 0 && (
                    <p className="text-body text-ink-muted">
                      {item.options.join(" · ")}
                    </p>
                  )}
                </div>
                <p className="text-ink tabular-nums">
                  {formatRupiah(item.lineTotal)}
                </p>
              </li>
            ))}
          </ul>
          <div className="flex border-t border-line pt-3 text-owner-body font-semibold text-ink">
            <span className="flex-1">{t("counter.total")}</span>
            <span className="tabular-nums">{formatRupiah(order.total)}</span>
          </div>

          {order.paidAt && (
            <a
              href={`/s/${order.publicToken}/receipt`}
              target="_blank"
              rel="noopener"
              className="focus-ring flex h-12 items-center justify-center gap-2 rounded-full border-[1.5px] border-border-strong bg-surface px-5 text-label text-brand active:bg-surface-sunken"
            >
              <ReceiptText aria-hidden="true" size={20} />
              {t("counter.viewReceipt")}
            </a>
          )}
        </>
      )}
    </section>
  );
}

export function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="flex-1 text-right font-semibold text-ink">{children}</dd>
    </div>
  );
}
