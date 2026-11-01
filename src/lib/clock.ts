"use client";

import { useSyncExternalStore } from "react";

// The current second, ticking; null on the server and during hydration so
// countdown markup matches. Seconds since the epoch, so the value only
// changes once a second.
const subscribeSecond = (onTick: () => void) => {
  const id = setInterval(onTick, 1000);
  return () => clearInterval(id);
};
const currentSecond = () => Math.floor(Date.now() / 1000);

export function useCurrentSecond(): number | null {
  return useSyncExternalStore(subscribeSecond, currentSecond, () => null);
}
