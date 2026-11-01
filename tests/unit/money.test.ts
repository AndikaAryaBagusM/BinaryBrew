import { describe, expect, it } from "vitest";
import {
  divideRoundHalfUp,
  exclusiveTaxAmount,
  formatBpsAsPercent,
  formatPriceDelta,
  formatRupiah,
  inclusiveTaxAmount,
  parseRupiahInput,
  percentToBps,
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

describe("formatPriceDelta (C-02 option prices)", () => {
  it.each([
    [5_000, "+Rp 5.000"],
    [-2_000, "−Rp 2.000"],
  ])("%i → %s", (delta, expected) => {
    expect(formatPriceDelta(delta)).toBe(expected);
  });

  it("shows nothing for a free option", () => {
    expect(formatPriceDelta(0)).toBe("");
  });
});

describe("exclusiveTaxAmount (tax_inclusive = false)", () => {
  it.each([
    [42_000, 0, 0],
    [42_000, 1_100, 4_620], // 11 %
    [22_000, 1_100, 2_420],
    [12_345, 1_100, 1_358], // 1357.95 → 1358
    [50, 1_000, 5],
    [5, 1_000, 1], // 0.5 → 1
  ])("base %i at %i bps = %i", (base, bps, expected) => {
    expect(exclusiveTaxAmount(base, bps)).toBe(expected);
  });

  it("rejects a negative base", () => {
    expect(() => exclusiveTaxAmount(-1, 1_100)).toThrow(RangeError);
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

describe("parseRupiahInput (O-03 price field)", () => {
  it.each([
    ["22000", 22_000],
    ["22.000", 22_000],
    ["Rp 22.000", 22_000],
    ["rp22.000", 22_000],
    [" 1.500.000 ", 1_500_000],
    ["0", 0],
  ])("%j → %i", (text, amount) => {
    expect(parseRupiahInput(text)).toBe(amount);
  });

  it.each(["", "abc", "22,5", "-5000", "22.000,00", "1234567890"])(
    "refuses %j",
    (text) => {
      expect(parseRupiahInput(text)).toBeNull();
    },
  );
});

describe("percentToBps and formatBpsAsPercent (O-14 rates)", () => {
  it.each([
    ["0", 0],
    ["11", 1_100],
    ["11,5", 1_150],
    ["11.25", 1_125],
    ["10 %", 1_000],
    ["100", 10_000],
  ])("%j → %i bps", (text, bps) => {
    expect(percentToBps(text)).toBe(bps);
  });

  it.each(["", "abc", "100,01", "101", "-1", "1,234", "5%%"])(
    "refuses %j",
    (text) => {
      expect(percentToBps(text)).toBeNull();
    },
  );

  it.each([
    [0, "0"],
    [1_100, "11"],
    [1_150, "11,5"],
    [1_125, "11,25"],
    [10_000, "100"],
  ])("%i bps → %j, and back", (bps, text) => {
    expect(formatBpsAsPercent(bps)).toBe(text);
    expect(percentToBps(text)).toBe(bps);
  });
});
