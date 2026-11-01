import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  formatQueueNumber,
  trackerStep,
} from "@/lib/order-display";

// C-05 countdown and C-06 number and tracker (Design §7).

describe("formatQueueNumber", () => {
  it.each([
    [1, "#001"],
    [14, "#014"],
    [999, "#999"],
    [1234, "#1234"],
  ])("%i → %s", (n, text) => {
    expect(formatQueueNumber(n)).toBe(text);
  });
});

describe("formatCountdown", () => {
  it.each([
    [600_000, "10:00"],
    [581_000, "09:41"],
    // Rounds up, so "00:00" appears only when time is really up.
    [59_001, "01:00"],
    [1, "00:01"],
    [0, "00:00"],
    [-5_000, "00:00"],
  ])("%i ms → %s", (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });
});

describe("trackerStep", () => {
  it("maps statuses to Diterima → Disiapkan → Siap diambil", () => {
    expect(trackerStep("paid")).toBe(0);
    expect(trackerStep("preparing")).toBe(1);
    expect(trackerStep("ready")).toBe(2);
    // Collected: every step done.
    expect(trackerStep("completed")).toBe(3);
  });

  it.each(["awaiting_payment", "expired", "voided"] as const)(
    "has no step for %s",
    (status) => {
      expect(trackerStep(status)).toBe(-1);
    },
  );
});
