import { t } from "@/i18n";
import type { Json } from "@/lib/api-client";
import type { OwnerOrderRow } from "@/modules/orders/service";
import type { RefundSummary } from "@/modules/payments/service";

// O-12 shapes (the JSON of GET /api/owner/orders and /api/owner/refunds)
// and query keys, shared by the screen and its cards.

export type OrdersData = Json<{
  date: string;
  today: string;
  orders: OwnerOrderRow[];
}>;
export type OrderRowData = OrdersData["orders"][number];
export type RefundsData = Json<{ refunds: RefundSummary[] }>;
export type RefundData = RefundsData["refunds"][number];

export const ORDERS_QUERY = ["owner", "orders"] as const;
export const REFUNDS_QUERY = ["owner", "refunds"] as const;
export const ORDER_QUERY = (id: string) => ["owner", "order", id] as const;

// A late-payment refund keeps the system's English reason; say it in Indonesian.
export const refundReason = (refund: RefundData) =>
  refund.source === "late_payment"
    ? t("owner.refundLatePayment")
    : refund.reason;
