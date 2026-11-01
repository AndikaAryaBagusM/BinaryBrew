"use client";

import { useMemo } from "react";
import { type CartEntry, parseCart } from "@/lib/cart";
import { createLocalStore, useLocalStore } from "@/lib/local-store";

// The walk-in cart (S-02 left, FR-POS-01): item ids, options and quantities
// only, like the customer cart, kept in this tab's sessionStorage so a
// reload or the lock overlay does not lose it. Prices come from the menu.
const cartStore = createLocalStore("bb.counterCart", "session");

export function useCounterCart(): CartEntry[] {
  const raw = useLocalStore(cartStore);
  return useMemo(() => parseCart(raw), [raw]);
}

export function updateCounterCart(
  update: (entries: CartEntry[]) => CartEntry[],
) {
  const next = update(parseCart(cartStore.get()));
  cartStore.set(next.length === 0 ? null : JSON.stringify(next));
}

export function clearCounterCart() {
  cartStore.set(null);
}
