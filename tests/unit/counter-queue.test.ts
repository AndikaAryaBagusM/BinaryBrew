import { describe, expect, it } from "vitest";
import {
  formatLockCountdown,
  nextStatus,
  orderAgeMinutes,
  queueCounts,
  waitingCount,
} from "@/lib/counter-queue";

// S-02 queue column (Design §6.2, §7): one primary action per card, the age
// in minutes, and the counts above the list.

describe("nextStatus", () => {
  it("is the one step forward with its button label", () => {
    expect(nextStatus("paid")).toEqual({
      status: "preparing",
      label: "counter.start",
    });
    expect(nextStatus("preparing")).toEqual({
      status: "ready",
      label: "counter.ready",
    });
    expect(nextStatus("ready")).toEqual({
      status: "completed",
      label: "counter.collected",
    });
  });
});

describe("orderAgeMinutes", () => {
  const paidAt = "2026-11-01T10:00:00.000Z";
  it.each([
    [0, 0],
    [59_999, 0],
    [60_000, 1],
    [5 * 60_000 + 30_000, 5],
    [-5_000, 0], // tablet clock slightly behind
  ])("%i ms after payment → %i min", (ms, minutes) => {
    expect(orderAgeMinutes(paidAt, Date.parse(paidAt) + ms)).toBe(minutes);
  });
});

describe("queueCounts and waitingCount", () => {
  const orders = [
    { status: "paid" },
    { status: "paid" },
    { status: "preparing" },
    { status: "ready" },
    { status: "paid" },
  ] as const;

  it("counts Baru, Diproses and Siap", () => {
    expect(queueCounts(orders)).toEqual({ paid: 3, preparing: 1, ready: 1 });
    expect(queueCounts([])).toEqual({ paid: 0, preparing: 0, ready: 0 });
  });

  it("waiting means not started yet (lock overlay, E11)", () => {
    expect(waitingCount(orders)).toBe(3);
  });
});

describe("formatLockCountdown", () => {
  it.each([
    [180_000, "3:00"],
    [161_000, "2:41"],
    [59_001, "1:00"],
    [1, "0:01"],
    [0, "0:00"],
    [-1_000, "0:00"],
  ])("%i ms → %s", (ms, text) => {
    expect(formatLockCountdown(ms)).toBe(text);
  });
});
