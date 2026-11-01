import type { OrderChipStatus } from "@/components/status-chip";

// Shown on C-05 and C-06 (Design §7). Client-safe: no server imports.

// "#014" (Design §7 C-06); four digits once a day passes 999 orders.
export function formatQueueNumber(n: number): string {
  return `#${String(n).padStart(3, "0")}`;
}

// "09:41". Seconds round up, so "00:00" means the time is really up.
export function formatCountdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// Tracker Diterima → Disiapkan → Siap diambil: the current step, 3 when all
// are done (collected), -1 for an order that is not in the queue.
export function trackerStep(status: OrderChipStatus): number {
  switch (status) {
    case "paid":
      return 0;
    case "preparing":
      return 1;
    case "ready":
      return 2;
    case "completed":
      return 3;
    default:
      return -1;
  }
}
