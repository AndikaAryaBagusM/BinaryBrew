import { describe, expect, it } from "vitest";
import {
  divideRoundHalfUp,
  formatRupiah,
  inclusiveTaxAmount,
  serviceChargeAmount,
} from "@/lib/money";

describe("divideRoundHalfUp", () => {
  it.each([
    [0, 3, 0],
    [1, 2, 1], // 0.5 → 1
    [3, 2, 2], // 1.5 → 2
    [5, 2, 3], // 2.5 → 3 (half-up, not banker's rounding)
    [4, 3, 1], // 1.33 → 1
    [5, 3, 2], // 1.67 → 2
    [10, 5, 2],
    [2_100_000_000, 7, 300_000_000],
  ])("%i / %i = %i", (numerator, denominator, expected) => {
    expect(divideRoundHalfUp(numerator, denominator)).toBe(expected);
  });

  it.each([
    [-1, 2],
    [1.5, 2],
    [1, 0],
    [1, -2],
    [Number.NaN, 2],
    [2 ** 53, 2],
  ])("rejects %s / %s", (numerator, denominator) => {
    expect(() => divideRoundHalfUp(numerator, denominator)).toThrow(RangeError);
  });
});

describe("serviceChargeAmount (Schema §5.1)", () => {
  it.each([
    [40_000, 0, 0],
    [40_000, 500, 2_000], // 5 %
    [12_345, 500, 617], // 617.25 → 617
    [12_350, 500, 618], // 617.5 → 618
    [25_000, 1_000, 2_500],
    [0, 1_000, 0],
  ])("subtotal %i at %i bps = %i", (subtotal, bps, expected) => {
    expect(serviceChargeAmount(subtotal, bps)).toBe(expected);
  });

  it("rejects a negative rate", () => {
    expect(() => serviceChargeAmount(10_000, -1)).toThrow(RangeError);
  });
});

describe("inclusiveTaxAmount (Schema §5.1)", () => {
  it.each([
    [22_000, 0, 0],
    [22_000, 1_100, 2_180], // 11 %: 22000 × 1100 / 11100 = 2180.18
    [11_100, 1_100, 1_100], // exact
    [40_000, 1_000, 3_636], // 10 %: 3636.36
    [55_500, 1_100, 5_500], // exact
    [1, 1_100, 0], // 0.099
    [111, 1_100, 11], // 11.0
    [5, 10_000, 3], // 2.5 → 3 at 100 %
  ])("total %i at %i bps = %i", (total, bps, expected) => {
    expect(inclusiveTaxAmount(total, bps)).toBe(expected);
  });

  it("never exceeds the total", () => {
    for (let total = 0; total <= 2_000; total += 7) {
      expect(inclusiveTaxAmount(total, 1_100)).toBeLessThanOrEqual(total);
    }
  });

  it("rejects a non-integer total", () => {
    expect(() => inclusiveTaxAmount(100.5, 1_100)).toThrow(RangeError);
  });
});

describe("formatRupiah (Design §9)", () => {
  // A non-breaking space keeps "Rp" and the amount on one line.
  it.each([
    [0, "Rp 0"],
    [500, "Rp 500"],
    [22_000, "Rp 22.000"],
    [1_234_567, "Rp 1.234.567"],
    [-2_000, "-Rp 2.000"],
  ])("%i → %s", (amount, expected) => {
    expect(formatRupiah(amount)).toBe(expected);
  });

  it("rejects a fractional amount", () => {
    expect(() => formatRupiah(1.5)).toThrow(RangeError);
  });
});
