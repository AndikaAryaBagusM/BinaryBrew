import type { MessageKey } from "@/i18n";

// S-02 queue column helpers (Design §6.2, §7). Client and server safe.

export type QueueStatus = "paid" | "preparing" | "ready";

const steps = {
  paid: { status: "preparing", label: "counter.start" },
  preparing: { status: "ready", label: "counter.ready" },
  ready: { status: "completed", label: "counter.collected" },
} as const satisfies Record<QueueStatus, { status: string; label: MessageKey }>;

// The card's one primary action: the next step forward (BR-01).
export function nextStatus<S extends QueueStatus>(status: S) {
  return steps[status];
}

// Whole minutes since payment; never negative when the tablet clock lags.
export function orderAgeMinutes(paidAt: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(paidAt)) / 60_000));
}

export function queueCounts(orders: readonly { status: QueueStatus }[]) {
  const counts = { paid: 0, preparing: 0, ready: 0 };
  for (const { status } of orders) counts[status]++;
  return counts;
}

// Orders nobody has started yet (lock overlay, Flow E11).
export function waitingCount(orders: readonly { status: QueueStatus }[]) {
  return queueCounts(orders).paid;
}

// Header "Terkunci otomatis dalam 2:41" (Figma S-02): minutes without a
// leading zero, rounded up so 0:00 shows only at the lock.
export function formatLockCountdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
