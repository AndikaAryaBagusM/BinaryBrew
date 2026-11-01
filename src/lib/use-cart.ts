"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  CART_KEY,
  type CartEntry,
  parseCart,
  readCart,
  writeCart,
} from "./cart";

// React access to the sessionStorage cart. Every component using it re-renders
// after updateCart, in this tab; other tabs follow through the storage event.

const listeners = new Set<() => void>();

// When sessionStorage is blocked the cart still works until the page closes.
let fallback: string | null = null;
const storage = {
  getItem(key: string): string | null {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return fallback;
    }
  },
  setItem(key: string, value: string) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      fallback = value;
    }
  },
};

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

const snapshot = () => storage.getItem(CART_KEY);

// undefined on the server and during hydration (the cart is not known
// there), so the markup matches and pages can avoid an "empty cart" flash.
export function useCartEntries(): CartEntry[] | undefined {
  const raw = useSyncExternalStore<string | null | undefined>(
    subscribe,
    snapshot,
    () => undefined,
  );
  return useMemo(() => (raw === undefined ? undefined : parseCart(raw)), [raw]);
}

export function updateCart(update: (entries: CartEntry[]) => CartEntry[]) {
  writeCart(storage, update(readCart(storage)));
  for (const listener of listeners) listener();
}
