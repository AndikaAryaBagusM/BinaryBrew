import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startRepeating } from "@/lib/repeat";

// The worker's loop (P1-09): run now, then every interval; never two runs at
// once; a failing run is reported and the loop goes on; stop() waits for the
// run in progress.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe("startRepeating", () => {
  it("runs at once, then every interval", async () => {
    const task = vi.fn(async () => {});
    const loop = startRepeating(task, 30_000, { onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(task).toHaveBeenCalledTimes(4);
    await loop.stop();
  });

  it("never overlaps: the next run waits for a slow one", async () => {
    const slow = deferred();
    let running = 0;
    let maxRunning = 0;
    const task = vi.fn(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      if (task.mock.calls.length === 1) await slow.promise;
      running--;
    });
    const loop = startRepeating(task, 1_000, { onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(task).toHaveBeenCalledTimes(1);
    slow.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task).toHaveBeenCalledTimes(2);
    expect(maxRunning).toBe(1);
    await loop.stop();
  });

  it("reports a failing run and keeps going", async () => {
    const onError = vi.fn();
    const task = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("database down"))
      .mockResolvedValue();
    const loop = startRepeating(task, 1_000, { onError });
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task).toHaveBeenCalledTimes(2);
    await loop.stop();
  });

  it("stop() waits for the run in progress and prevents more", async () => {
    const slow = deferred();
    const task = vi.fn(() => slow.promise);
    const loop = startRepeating(task, 1_000, { onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);

    let stopped = false;
    const stopping = loop.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(stopped).toBe(false);
    slow.resolve();
    await stopping;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
