"use client";

import { useEffect, useEffectEvent, useRef, useSyncExternalStore } from "react";
import { type IdleTimer, startIdleTimer } from "@/lib/idle-timer";
import { createLocalStore, useLocalStore } from "@/lib/local-store";

// Counter auto-lock (FR-POS-03, PRD A3, Tech §9): 3 minutes without a touch
// or key press. The lock is stored per session so a reload stays locked; it
// covers the screen only, the session and PIN remain the real protection.

export const IDLE_LOCK_MS = 3 * 60_000;
const ACTIVITY = ["pointerdown", "keydown", "wheel"] as const;

export const lockStore = createLocalStore("bb.counterLock");

const subscribeSecond = (onTick: () => void) => {
  const id = setInterval(onTick, 1000);
  return () => clearInterval(id);
};

export function useIdleLock(sessionId: string) {
  const locked = useLocalStore(lockStore) === sessionId;
  const timer = useRef<IdleTimer | null>(null);

  const onActivity = useEffectEvent(() => {
    if (lockStore.get() !== sessionId) timer.current?.touch();
  });
  useEffect(() => {
    const idle = startIdleTimer(IDLE_LOCK_MS, () => lockStore.set(sessionId));
    timer.current = idle;
    const handler = () => onActivity();
    for (const name of ACTIVITY) {
      window.addEventListener(name, handler, { passive: true });
    }
    return () => {
      idle.stop();
      timer.current = null;
      for (const name of ACTIVITY) window.removeEventListener(name, handler);
    };
  }, [sessionId]);

  // Time left, in seconds, for the header; null until mounted.
  const remainingSeconds = useSyncExternalStore(
    subscribeSecond,
    () =>
      timer.current ? Math.ceil(timer.current.remainingMs() / 1000) : null,
    () => null,
  );

  return {
    locked,
    remainingMs: remainingSeconds === null ? null : remainingSeconds * 1000,
    lock: () => lockStore.set(sessionId),
    unlock: () => {
      lockStore.set(null);
      timer.current?.touch();
    },
  };
}
