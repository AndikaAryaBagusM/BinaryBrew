"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type ReactNode, useDeferredValue, useRef, useState } from "react";
import { TextField } from "@/components/field";
import { StatusChip } from "@/components/status-chip";
import { t } from "@/i18n";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatRupiah } from "@/lib/money";
import { formatQueueNumber } from "@/lib/order-display";
import { formatDate, formatTime } from "@/lib/time";
import { orderSearch } from "@/modules/orders/search";
import {
  Notice,
  PageBody,
  PageHead,
  TableCard,
  tabPanelProps,
  tdClass,
  thClass,
  useSignedOutGuard,
} from "../owner-ui";
import { OrderCard } from "./order-card";
import { RefundCard, RefundTag } from "./refund-card";
import {
  ORDERS_QUERY,
  type OrderRowData,
  type OrdersData,
  REFUNDS_QUERY,
  type RefundData,
  refundReason,
  type RefundsData,
} from "./shared";

export type { OrdersData, RefundsData } from "./shared";

type Tab = "orders" | "refunds";

// Noon in the shop's time zone, so the date never shifts a day.
export const dayLabel = (date: string) =>
  formatDate(new Date(`${date}T12:00:00+07:00`));

// O-12 (Figma 22:1930; P3-01, FR-OW-08, FR-PM-08): the orders of one
// business day (today first), searchable by number or payment reference,
// and the refunds: every open request (from a void or a late payment) and
// the latest processed ones. Choosing a row opens its card beside the table
// (below it on narrow screens). Marking a refund processed needs the
// owner's own PIN.
export function OrdersScreen({
  initialOrders,
  initialRefunds,
}: {
  initialOrders: OrdersData;
  initialRefunds: RefundsData;
}) {
  const signedOut = useSignedOutGuard();
  const [tab, setTab] = useState<Tab>("orders");
  const [date, setDate] = useState(initialOrders.date);
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const [orderId, setOrderId] = useState<string | null>(null);
  const [refundId, setRefundId] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const isInitial = date === initialOrders.date && q === "";
  const orders = useQuery({
    queryKey: [...ORDERS_QUERY, date, q],
    queryFn: async () => {
      const params = new URLSearchParams({ date });
      if (q) params.set("q", q);
      const result = await api<OrdersData>(`/api/owner/orders?${params}`);
      if (signedOut(result)) return null;
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    initialData: isInitial ? initialOrders : undefined,
    placeholderData: keepPreviousData,
  });
  const refunds = useQuery({
    queryKey: REFUNDS_QUERY,
    queryFn: async () => {
      const result = await api<RefundsData>("/api/owner/refunds");
      if (signedOut(result)) return null;
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    initialData: initialRefunds,
  });

  const orderRows = (orders.data ?? initialOrders).orders;
  const today = (orders.data ?? initialOrders).today;
  const allRefunds = (refunds.data ?? initialRefunds).refunds;
  const matches = orderSearch(q);
  const refundRows = allRefunds.filter((refund) =>
    matches(refund.queueNumber, [refund.paymentRef, refund.gatewayRef]),
  );
  const openCount = allRefunds.filter((r) => r.status === "requested").length;
  const selectedRefund = allRefunds.find((r) => r.id === refundId) ?? null;

  function reveal() {
    // Below the two-column width the card sits under the table.
    if (!window.matchMedia("(min-width: 80rem)").matches) {
      requestAnimationFrame(() =>
        cardRef.current?.scrollIntoView({ block: "start" }),
      );
    }
  }
  function openOrder(id: string) {
    setOrderId(id);
    reveal();
  }
  function openRefund(id: string) {
    setTab("refunds");
    setRefundId(id);
    reveal();
  }

  const card =
    tab === "orders"
      ? orderId && (
          <OrderCard
            key={orderId}
            orderId={orderId}
            onOpenRefund={openRefund}
            onClose={() => setOrderId(null)}
          />
        )
      : selectedRefund && (
          <RefundCard
            key={selectedRefund.id}
            refund={selectedRefund}
            onClose={() => setRefundId(null)}
          />
        );

  return (
    <PageBody>
      <PageHead
        title={t("owner.ordersTitle")}
        subtitle={
          date === today
            ? t("owner.ordersSubtitleToday")
            : t("owner.ordersSubtitleDay", { date: dayLabel(date) })
        }
      >
        <TextField
          label={t("owner.ordersDay")}
          type="date"
          className="w-48"
          value={date}
          max={today}
          onChange={(event) => {
            if (event.target.value) setDate(event.target.value);
          }}
        />
        <TextField
          label={t("owner.ordersSearch")}
          type="search"
          className="w-full sm:w-80"
          placeholder={t("owner.ordersSearchPlaceholder")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </PageHead>
      {(orders.isError || refunds.isError) && (
        <Notice tone="danger">{t("error.generic")}</Notice>
      )}

      <div
        role="tablist"
        aria-label={t("owner.ordersTitle")}
        className="flex gap-1 border-b border-line"
        onKeyDown={(event) => {
          // Two tabs: either arrow moves to the other one (WAI-ARIA tabs).
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const next = tab === "orders" ? "refunds" : "orders";
          setTab(next);
          document.getElementById(`o12-tab-${next}`)?.focus();
        }}
      >
        <TabButton
          id="orders"
          selected={tab === "orders"}
          onSelect={() => setTab("orders")}
          label={t("owner.ordersTabOrders")}
          count={
            <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-caption text-ink-muted tabular-nums">
              {orderRows.length}
            </span>
          }
        />
        <TabButton
          id="refunds"
          selected={tab === "refunds"}
          onSelect={() => setTab("refunds")}
          label={t("owner.ordersTabRefunds")}
          count={
            openCount > 0 && (
              <span className="flex size-6 items-center justify-center rounded-full bg-danger text-caption font-semibold text-on-brand tabular-nums">
                <span aria-hidden="true">{openCount}</span>
                <span className="sr-only">
                  {t("owner.refundOpenCount", { n: openCount })}
                </span>
              </span>
            )
          }
        />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_472px]">
        <div {...tabPanelProps("o12", tab)} className="min-w-0">
          {tab === "orders" ? (
            <OrdersTable
              rows={orderRows}
              selectedId={orderId}
              onSelect={openOrder}
              searching={q !== ""}
            />
          ) : (
            <RefundsTable
              rows={refundRows}
              selectedId={refundId}
              onSelect={openRefund}
            />
          )}
        </div>
        <div ref={cardRef} className="scroll-mt-6">
          {card}
        </div>
      </div>
    </PageBody>
  );
}

function TabButton({
  id,
  selected,
  onSelect,
  label,
  count,
}: {
  id: Tab;
  selected: boolean;
  onSelect: () => void;
  label: string;
  count: ReactNode;
}) {
  return (
    <button
      id={`o12-tab-${id}`}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={`o12-panel-${id}`}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      className={cn(
        "focus-ring -mb-px flex h-12 cursor-pointer items-center gap-2 border-b-2 px-3 text-owner-body",
        selected
          ? "border-accent font-semibold text-ink"
          : "border-transparent text-ink-muted hover:text-ink",
      )}
    >
      {label}
      {count}
    </button>
  );
}

const channelText = (row: {
  channel: "self_order" | "counter";
  table: string | null;
}) =>
  row.channel === "counter"
    ? t("owner.ordersChannelCounter")
    : row.table
      ? t("owner.ordersChannelQr", { table: row.table })
      : t("counter.channelSelfNoTable");

function OrdersTable({
  rows,
  selectedId,
  onSelect,
  searching,
}: {
  rows: OrderRowData[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  searching: boolean;
}) {
  return (
    <TableCard label={t("owner.ordersTabOrders")} minWidth="min-w-150">
      <thead>
        <tr>
          <th scope="col" className={`${thClass} w-24`}>
            {t("owner.ordersColNumber")}
          </th>
          <th scope="col" className={`${thClass} w-20`}>
            {t("owner.ordersColTime")}
          </th>
          <th scope="col" className={thClass}>
            {t("owner.ordersColChannel")}
          </th>
          <th scope="col" className={`${thClass} w-32 text-right`}>
            {t("owner.ordersColTotal")}
          </th>
          <th scope="col" className={`${thClass} w-44`}>
            {t("owner.ordersColStatus")}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={5} className={`${tdClass} text-ink-muted`}>
              {t(searching ? "owner.ordersNoMatch" : "owner.ordersEmpty")}
            </td>
          </tr>
        )}
        {rows.map((row) => {
          const selected = row.id === selectedId;
          return (
            <tr
              key={row.id}
              onClick={() => onSelect(row.id)}
              className={cn(
                "cursor-pointer",
                selected ? "bg-accent-soft" : "hover:bg-bg",
              )}
            >
              <td className={`${tdClass} font-semibold`}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(row.id);
                  }}
                  className="focus-ring cursor-pointer rounded-sm tabular-nums"
                >
                  {row.queueNumber === null
                    ? "—"
                    : formatQueueNumber(row.queueNumber)}
                  <span className="sr-only"> {t("owner.ordersOpen")}</span>
                </button>
              </td>
              <td className={`${tdClass} tabular-nums`}>
                {formatTime(new Date(row.createdAt))}
              </td>
              <td className={`${tdClass} truncate`}>{channelText(row)}</td>
              <td className={`${tdClass} text-right tabular-nums`}>
                {formatRupiah(row.total)}
              </td>
              <td className={tdClass}>
                <span className="flex flex-wrap items-center gap-1.5">
                  <StatusChip status={row.status} />
                  {row.refund && <RefundTag status={row.refund} />}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableCard>
  );
}

function RefundsTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: RefundData[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <TableCard label={t("owner.ordersTabRefunds")} minWidth="min-w-150">
      <thead>
        <tr>
          <th scope="col" className={`${thClass} w-24`}>
            {t("owner.ordersColNumber")}
          </th>
          <th scope="col" className={`${thClass} w-36`}>
            {t("owner.refundColRequested")}
          </th>
          <th scope="col" className={thClass}>
            {t("owner.refundColReason")}
          </th>
          <th scope="col" className={`${thClass} w-32 text-right`}>
            {t("owner.ordersColTotal")}
          </th>
          <th scope="col" className={`${thClass} w-32`}>
            {t("owner.ordersColStatus")}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={5} className={`${tdClass} text-ink-muted`}>
              {t("owner.refundsEmpty")}
            </td>
          </tr>
        )}
        {rows.map((row) => {
          const selected = row.id === selectedId;
          const at = new Date(row.createdAt);
          return (
            <tr
              key={row.id}
              onClick={() => onSelect(row.id)}
              className={cn(
                "cursor-pointer",
                selected ? "bg-accent-soft" : "hover:bg-bg",
              )}
            >
              <td className={`${tdClass} font-semibold`}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(row.id);
                  }}
                  className="focus-ring cursor-pointer rounded-sm tabular-nums"
                >
                  {row.queueNumber === null
                    ? "—"
                    : formatQueueNumber(row.queueNumber)}
                  <span className="sr-only"> {t("owner.refundOpen")}</span>
                </button>
              </td>
              <td className={`${tdClass} whitespace-nowrap tabular-nums`}>
                {formatDate(at)}, {formatTime(at)}
              </td>
              <td className={`${tdClass} truncate`}>{refundReason(row)}</td>
              <td className={`${tdClass} text-right tabular-nums`}>
                {formatRupiah(row.amount)}
              </td>
              <td className={tdClass}>
                <RefundTag status={row.status} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableCard>
  );
}
