import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startIdleTimer } from "@/lib/idle-timer";

// Counter auto-lock (FR-POS-03, PRD A3): 3 minutes without activity.

beforeEach(() => vi.useFakeTimers({ now: 0 }));
afterEach(() => vi.useRealTimers());

const THREE_MINUTES = 3 * 60_000;

describe("startIdleTimer", () => {
  it("fires once after the timeout without activity", () => {
    const onIdle = vi.fn();
    const timer = startIdleTimer(THREE_MINUTES, onIdle);
    vi.advanceTimersByTime(THREE_MINUTES - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(THREE_MINUTES * 2);
    expect(onIdle).toHaveBeenCalledTimes(1);
    timer.stop();
  });

  it("starts over on activity and reports the time left", () => {
    const onIdle = vi.fn();
    const timer = startIdleTimer(THREE_MINUTES, onIdle);
    vi.advanceTimersByTime(2 * 60_000);
    expect(timer.remainingMs()).toBe(60_000);
    timer.touch();
    expect(timer.remainingMs()).toBe(THREE_MINUTES);
    vi.advanceTimersByTime(THREE_MINUTES - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(timer.remainingMs()).toBe(0);
    timer.stop();
  });

  it("restarts after firing when touched again (unlocked)", () => {
    const onIdle = vi.fn();
    const timer = startIdleTimer(THREE_MINUTES, onIdle);
    vi.advanceTimersByTime(THREE_MINUTES);
    timer.touch();
    vi.advanceTimersByTime(THREE_MINUTES);
    expect(onIdle).toHaveBeenCalledTimes(2);
    timer.stop();
  });

  it("stop() cancels it", () => {
    const onIdle = vi.fn();
    const timer = startIdleTimer(THREE_MINUTES, onIdle);
    timer.stop();
    vi.advanceTimersByTime(THREE_MINUTES * 2);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
