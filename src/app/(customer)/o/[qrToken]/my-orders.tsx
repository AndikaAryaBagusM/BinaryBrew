"use client";

import { ReceiptText } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Sheet } from "@/components/sheet";
import { t } from "@/i18n";
import { readRecentOrders, RECENT_ORDERS_KEY } from "@/lib/recent-orders";
import { formatTime } from "@/lib/time";

// "Pesanan saya" (Design §7 C-01): shown only when this browser remembers
// recent orders; each one links to its status page.
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function storedOrders(): string | null {
  try {
    return window.localStorage.getItem(RECENT_ORDERS_KEY);
  } catch {
    return null;
  }
}

export function MyOrders() {
  // null on the server and before hydration, so the markup matches.
  const raw = useSyncExternalStore(subscribe, storedOrders, () => null);
  if (raw === null) return null;
  const orders = readRecentOrders(
    { getItem: () => raw, setItem: () => {} },
    new Date(),
  );
  if (orders.length === 0) return null;

  return (
    <Sheet
      title={t("menu.myOrders")}
      trigger={
        <button
          type="button"
          className="focus-ring flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-card px-3 text-label text-brand active:bg-accent-soft"
        >
          <ReceiptText aria-hidden="true" size={20} />
          {t("menu.myOrders")}
        </button>
      }
    >
      <ul className="flex flex-col divide-y divide-line">
        {orders.map((order) => (
          <li
            key={order.publicToken}
            className="flex items-center justify-between gap-3 py-3"
          >
            <span className="text-body text-ink">
              {t("menu.orderedAt", {
                time: formatTime(new Date(order.createdAt)),
              })}
            </span>
            <Link
              href={`/s/${order.publicToken}`}
              className="focus-ring flex min-h-11 items-center rounded-card px-2 text-label text-brand underline underline-offset-4"
            >
              {t("menu.statusLink")}
            </Link>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
