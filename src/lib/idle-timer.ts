// Calls onIdle once when touch() has not been called for timeoutMs (Counter
// auto-lock, FR-POS-03). touch() after that starts a new period.

export type IdleTimer = {
  touch: () => void;
  stop: () => void;
  remainingMs: () => number;
};

export function startIdleTimer(
  timeoutMs: number,
  onIdle: () => void,
): IdleTimer {
  let lastActivity = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(onIdle, timeoutMs);
  };
  schedule();

  return {
    touch() {
      lastActivity = Date.now();
      schedule();
    },
    stop() {
      clearTimeout(timer);
    },
    remainingMs() {
      return Math.max(0, lastActivity + timeoutMs - Date.now());
    },
  };
}
