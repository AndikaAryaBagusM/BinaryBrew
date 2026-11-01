"use client";

import { useSyncExternalStore } from "react";

// One localStorage (or sessionStorage) value that components can watch
// (Counter mute, lock and cart). Storage can be blocked: reads then give
// null and writes do nothing, so the page still works (Design §8).

export type LocalStore = {
  get: () => string | null;
  set: (value: string | null) => void;
  subscribe: (onChange: () => void) => () => void;
};

export function createLocalStore(
  key: string,
  area: "local" | "session" = "local",
): LocalStore {
  const listeners = new Set<() => void>();
  const storage = () => (area === "local" ? localStorage : sessionStorage);
  return {
    get() {
      try {
        return storage().getItem(key);
      } catch {
        return null;
      }
    },
    set(value) {
      try {
        if (value === null) storage().removeItem(key);
        else storage().setItem(key, value);
      } catch {
        // Not stored; this tab still updates below.
      }
      for (const listener of listeners) listener();
    },
    subscribe(onChange) {
      listeners.add(onChange);
      // Other tabs of the same browser.
      const onStorage = (event: StorageEvent) => {
        if (event.key === key) onChange();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}

// The stored value; null on the server and during hydration.
export function useLocalStore(store: LocalStore): string | null {
  return useSyncExternalStore(store.subscribe, store.get, () => null);
}
