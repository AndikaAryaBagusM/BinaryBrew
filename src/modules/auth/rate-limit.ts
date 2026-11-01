// In-memory sliding-window limiter (Tech §9). Correct while there is one app
// process; it must move to the database or a shared store before running more
// than one instance. Times are epoch milliseconds so tests can pass a clock.
export type RateLimiter = ReturnType<typeof createRateLimiter>;

export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
}) {
  const { limit, windowMs } = options;
  const hits = new Map<string, number[]>();
  let lastSweep = Number.NEGATIVE_INFINITY;

  function recent(key: string, now: number): number[] {
    const kept = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (kept.length > 0) hits.set(key, kept);
    else hits.delete(key);
    return kept;
  }

  // At most once per window, drop keys whose hits have all expired.
  function sweep(now: number) {
    if (now - lastSweep < windowMs) return;
    lastSweep = now;
    for (const key of [...hits.keys()]) recent(key, now);
  }

  return {
    isLimited(key: string, now = Date.now()): boolean {
      return recent(key, now).length >= limit;
    },
    hit(key: string, now = Date.now()): void {
      sweep(now);
      hits.set(key, [...recent(key, now), now]);
    },
    reset(key: string): void {
      hits.delete(key);
    },
    clear(): void {
      hits.clear();
      lastSweep = Number.NEGATIVE_INFINITY;
    },
    size(): number {
      return hits.size;
    },
  };
}
