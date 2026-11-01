"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "@/components/button";
import { EdgeState } from "@/components/edge-state";
import { t } from "@/i18n";
import { useCurrentSecond } from "@/lib/clock";
import { updateCart } from "@/lib/use-cart";
import { useEventStream } from "@/lib/use-event-stream";
import type { PublicOrder } from "@/modules/orders/service";
import { PaymentView } from "./payment-view";
import { StatusView } from "./status-view";

// The status link's one live page (Tech §7): C-05 while unpaid, C-06 once
// paid, C-08 "payment expired". Polls every 10 s; every SSE event and
// reconnect refetches at once.

type Payment = NonNullable<PublicOrder["payment"]>;
export type OrderData = Omit<
  PublicOrder,
  "createdAt" | "paidAt" | "expiresAt" | "payment"
> & {
  createdAt: string;
  paidAt: string | null;
  expiresAt: string | null;
  payment: (Omit<Payment, "expiresAt"> & { expiresAt: string | null }) | null;
};

const POLL_MS = 10_000;
const IN_QUEUE = new Set(["paid", "preparing", "ready", "completed"]);

async function fetchOrder(publicToken: string): Promise<OrderData> {
  const response = await fetch(`/api/public/orders/${publicToken}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`order request failed: ${response.status}`);
  }
  return (await response.json()).data;
}

export function OrderScreen({
  initial,
  qr,
  mockPay,
}: {
  initial: OrderData;
  qr: ReactNode;
  mockPay: boolean;
}) {
  const publicToken = initial.publicToken;
  const queryClient = useQueryClient();
  const queryKey = ["order", publicToken];
  const { data: order } = useQuery({
    queryKey,
    queryFn: () => fetchOrder(publicToken),
    initialData: initial,
    refetchInterval: POLL_MS,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  useEventStream(`/api/stream/orders/${publicToken}`, "order", () => {
    void refresh();
  });

  // Paid while watching: the cart that made this order is done.
  const startedUnpaid = useRef(initial.status === "awaiting_payment");
  useEffect(() => {
    if (startedUnpaid.current && IN_QUEUE.has(order.status)) {
      startedUnpaid.current = false;
      updateCart(() => []);
    }
  }, [order.status]);

  const second = useCurrentSecond();
  const deadline = order.expiresAt ? Date.parse(order.expiresAt) : null;
  const remainingMs =
    deadline === null || second === null ? null : deadline - second * 1000;

  if (order.status === "awaiting_payment") {
    // The sweep (P1-09) expires it on the server; the customer sees it now.
    if (remainingMs !== null && remainingMs <= 0) {
      return <Expired menuPath={order.menuPath} />;
    }
    if (!order.payment?.qrString || !qr) {
      return (
        <EdgeState
          variant="error"
          action={
            <Button onClick={() => window.location.reload()}>
              {t("common.retry")}
            </Button>
          }
        />
      );
    }
    return (
      <PaymentView
        order={order}
        payment={order.payment}
        qr={qr}
        remainingMs={remainingMs}
        mockPay={mockPay}
        onChange={refresh}
      />
    );
  }
  if (order.status === "expired") return <Expired menuPath={order.menuPath} />;
  return <StatusView order={order} />;
}

function Expired({ menuPath }: { menuPath: string | null }) {
  return (
    <EdgeState
      variant="paymentExpired"
      action={
        menuPath && (
          <Link
            href={menuPath}
            className="focus-ring inline-flex h-12 items-center rounded-card bg-brand px-5 text-label text-on-brand active:bg-brand-pressed"
          >
            {t("pay.orderAgain")}
          </Link>
        )
      }
    />
  );
}
