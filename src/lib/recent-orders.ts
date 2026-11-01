// "Pesanan saya" (Flow §3): the browser keeps the last few order links in
// localStorage so a customer who closed the tab can reopen their status page.
// Only the public token and a time are stored: no personal data (D19).

export const RECENT_ORDERS_KEY = "bb.recentOrders";

const MAX_ORDERS = 5;
const MAX_AGE_MS = 24 * 60 * 60_000;

export type RecentOrder = { publicToken: string; createdAt: string };

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

function isRecentOrder(value: unknown): value is RecentOrder {
  if (typeof value !== "object" || value === null) return false;
  const { publicToken, createdAt } = value as Record<string, unknown>;
  return (
    typeof publicToken === "string" &&
    publicToken !== "" &&
    typeof createdAt === "string" &&
    !Number.isNaN(Date.parse(createdAt))
  );
}

// Newest first, at most 5, none older than 24 hours. Broken, foreign or
// blocked storage (private mode) reads as empty.
export function readRecentOrders(
  storage: KeyValueStorage,
  now: Date,
): RecentOrder[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(RECENT_ORDERS_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(isRecentOrder)
    .filter((order) => now.getTime() - Date.parse(order.createdAt) < MAX_AGE_MS)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_ORDERS);
}

// Called after checkout (C-03). Never throws: losing the list is acceptable.
export function rememberOrder(
  storage: KeyValueStorage,
  publicToken: string,
  now: Date,
): void {
  const others = readRecentOrders(storage, now).filter(
    (order) => order.publicToken !== publicToken,
  );
  const orders = [{ publicToken, createdAt: now.toISOString() }, ...others];
  try {
    storage.setItem(
      RECENT_ORDERS_KEY,
      JSON.stringify(orders.slice(0, MAX_ORDERS)),
    );
  } catch {
    // Storage full or blocked.
  }
}
