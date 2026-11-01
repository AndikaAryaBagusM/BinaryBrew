"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { OrderTracker } from "@/components/order-tracker";
import { StatusChip } from "@/components/status-chip";
import { t, type MessageKey } from "@/i18n";
import { playChime } from "@/lib/chime";
import { cn } from "@/lib/cn";
import { formatQueueNumber, trackerStep } from "@/lib/order-display";
import type { OrderData } from "./order-screen";

// C-06 Status (Design §7): the number in Display style, the tracker and the
// items. At Ready the heading changes, and the phone vibrates and chimes,
// but only after the customer has touched the page (browser rule); the
// visual change is always there (Design §8).

const text: Partial<Record<OrderData["status"], MessageKey>> = {
  paid: "status.preparingText",
  preparing: "status.preparingText",
  ready: "status.readyText",
  completed: "status.completedText",
  voided: "status.voidedText",
};

function useReadyAlert(ready: boolean) {
  const wasReady = useRef(ready);
  useEffect(() => {
    if (ready && !wasReady.current && navigator.userActivation?.hasBeenActive) {
      navigator.vibrate?.([200, 100, 200]);
      playChime();
    }
    wasReady.current = ready;
  }, [ready]);
}

export function StatusView({ order }: { order: OrderData }) {
  const ready = order.status === "ready";
  useReadyAlert(ready);
  const message = text[order.status];

  return (
    <main className="mx-auto flex w-full max-w-120 flex-1 flex-col gap-6 px-4 pt-8 pb-8">
      <section
        aria-live="polite"
        className="flex flex-col items-center gap-2 text-center"
      >
        <h1
          className={
            ready ? "text-h1 text-status-ready-fg" : "text-label text-ink-muted"
          }
        >
          {t(ready ? "status.readyTitle" : "status.numberLabel")}
        </h1>
        {order.queueNumber !== null && (
          <p
            data-testid="queue-number"
            className={cn(
              "text-display",
              ready ? "text-status-ready-fg" : "text-ink",
            )}
          >
            {formatQueueNumber(order.queueNumber)}
          </p>
        )}
        {order.status === "voided" && <StatusChip status="voided" size="l" />}
        {message && <p className="text-body text-ink">{t(message)}</p>}
      </section>

      {order.status !== "voided" && (
        <OrderTracker step={trackerStep(order.status)} />
      )}

      <section className="flex flex-col gap-2 rounded-card bg-surface p-3 shadow-card">
        <h2 className="text-label text-ink">{t("status.itemsTitle")}</h2>
        <ul className="flex flex-col gap-1">
          {order.items.map((item, index) => (
            <li key={index} className="text-body text-ink">
              {item.quantity}× {item.name}
              {item.options.length > 0 && (
                <span className="text-caption text-ink-muted">
                  {" "}
                  · {item.options.join(", ")}
                </span>
              )}
            </li>
          ))}
        </ul>
        <Link
          href={`/s/${order.publicToken}/receipt`}
          className="focus-ring flex min-h-11 items-center self-start rounded-card text-label text-brand underline underline-offset-4"
        >
          {t("status.receiptLink")}
        </Link>
      </section>

      <p className="text-center text-caption text-ink-muted">
        {t("status.autoUpdate")}
      </p>
    </main>
  );
}
