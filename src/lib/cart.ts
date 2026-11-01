import {
  type CartLine,
  MAX_LINES,
  MAX_QUANTITY,
  type PricingItem,
  selectionProblems,
} from "@/modules/orders/pricing";

// The customer's cart (Flow §3): kept in sessionStorage until checkout, as
// item ids, chosen options and quantities. Prices are never stored; they are
// always computed from the current menu by the pricing service.

export const CART_KEY = "bb.cart";

export type CartEntry = CartLine & {
  lineId: string;
  modifierOptionIds: string[];
};

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

// Not crypto.randomUUID: phones open the app over plain HTTP on the LAN, where
// it is unavailable. The id only has to be unique within one cart.
export const newLineId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function isEntry(value: unknown): value is CartEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.lineId === "string" &&
    typeof entry.menuItemId === "string" &&
    typeof entry.quantity === "number" &&
    Array.isArray(entry.modifierOptionIds) &&
    entry.modifierOptionIds.every((id) => typeof id === "string")
  );
}

// Broken, foreign or blocked storage (private mode) reads as an empty cart.
export function parseCart(raw: string | null): CartEntry[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) && parsed.every(isEntry) ? parsed : [];
  } catch {
    return [];
  }
}

export function readCart(storage: KeyValueStorage): CartEntry[] {
  try {
    return parseCart(storage.getItem(CART_KEY));
  } catch {
    return [];
  }
}

export function writeCart(storage: KeyValueStorage, entries: CartEntry[]) {
  try {
    storage.setItem(
      CART_KEY,
      JSON.stringify(
        entries.map(({ lineId, menuItemId, quantity, modifierOptionIds }) => ({
          lineId,
          menuItemId,
          quantity,
          modifierOptionIds,
        })),
      ),
    );
  } catch {
    // Storage full or blocked: the cart lives until the page closes.
  }
}

const clampQuantity = (quantity: number) =>
  Math.min(MAX_QUANTITY, Math.max(1, Math.trunc(quantity)));

const sameOptions = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

// Same item with the same options (in any order) adds to the existing line.
export function addToCart(
  entries: CartEntry[],
  line: CartLine,
  newId: () => string = newLineId,
): { entries: CartEntry[]; result: "added" | "merged" | "full" } {
  const match = entries.find(
    (entry) =>
      entry.menuItemId === line.menuItemId &&
      sameOptions(entry.modifierOptionIds, line.modifierOptionIds),
  );
  if (match) {
    return {
      result: "merged",
      entries: entries.map((entry) =>
        entry === match
          ? {
              ...entry,
              quantity: clampQuantity(entry.quantity + line.quantity),
            }
          : entry,
      ),
    };
  }
  if (entries.length >= MAX_LINES) return { entries, result: "full" };
  return {
    result: "added",
    entries: [
      ...entries,
      {
        lineId: newId(),
        menuItemId: line.menuItemId,
        quantity: clampQuantity(line.quantity),
        modifierOptionIds: [...line.modifierOptionIds],
      },
    ],
  };
}

export function setLineQuantity(
  entries: CartEntry[],
  lineId: string,
  quantity: number,
): CartEntry[] {
  return entries.map((entry) =>
    entry.lineId === lineId
      ? { ...entry, quantity: clampQuantity(quantity) }
      : entry,
  );
}

export function removeLine(entries: CartEntry[], lineId: string): CartEntry[] {
  return entries.filter((entry) => entry.lineId !== lineId);
}

export function cartQuantity(entries: readonly CartEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.quantity, 0);
}

// The menu may have changed since a line was added: lines whose item or
// options are gone are dropped; sold-out lines stay, marked, so the customer
// sees what happened (Design §7 C-03).
export function reconcileCart(
  entries: readonly CartEntry[],
  items: readonly (PricingItem & { isAvailable: boolean })[],
): { entries: CartEntry[]; soldOut: Set<string> } {
  const byId = new Map(items.map((item) => [item.id, item]));
  const kept: CartEntry[] = [];
  const soldOut = new Set<string>();
  for (const entry of entries) {
    const item = byId.get(entry.menuItemId);
    if (!item) continue;
    if (selectionProblems(item, entry.modifierOptionIds).length > 0) continue;
    if (!Number.isInteger(entry.quantity)) continue;
    kept.push({ ...entry, quantity: clampQuantity(entry.quantity) });
    if (!item.isAvailable) soldOut.add(entry.lineId);
  }
  return { entries: kept, soldOut };
}

export function toCartLines(entries: readonly CartEntry[]): CartLine[] {
  return entries.map(({ menuItemId, quantity, modifierOptionIds }) => ({
    menuItemId,
    quantity,
    modifierOptionIds,
  }));
}
