import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/modules/auth/rate-limit";

describe("createRateLimiter (sliding window, Tech §9)", () => {
  const t0 = 1_000_000;

  it("limits after the configured number of hits inside the window", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
    expect(limiter.isLimited("a", t0)).toBe(false);
    limiter.hit("a", t0);
    limiter.hit("a", t0 + 100);
    expect(limiter.isLimited("a", t0 + 200)).toBe(false);
    limiter.hit("a", t0 + 200);
    expect(limiter.isLimited("a", t0 + 300)).toBe(true);
    expect(limiter.isLimited("b", t0 + 300)).toBe(false);
  });

  it("forgets hits older than the window, one by one", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
    limiter.hit("a", t0);
    limiter.hit("a", t0 + 500);
    expect(limiter.isLimited("a", t0 + 999)).toBe(true);
    expect(limiter.isLimited("a", t0 + 1000)).toBe(false); // first hit expired
    limiter.hit("a", t0 + 1000);
    expect(limiter.isLimited("a", t0 + 1499)).toBe(true);
  });

  it("can be reset per key or entirely", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    limiter.hit("a", t0);
    limiter.hit("b", t0);
    limiter.reset("a");
    expect(limiter.isLimited("a", t0)).toBe(false);
    expect(limiter.isLimited("b", t0)).toBe(true);
    limiter.clear();
    expect(limiter.isLimited("b", t0)).toBe(false);
  });

  it("drops keys whose hits have all expired, so memory stays bounded", () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 1000 });
    for (let i = 0; i < 100; i++) limiter.hit(`ip-${i}`, t0);
    expect(limiter.size()).toBe(100);
    limiter.hit("late", t0 + 5000);
    expect(limiter.size()).toBe(1);
  });
});
