import { describe, expect, it } from "vitest";
import { formatUnitCost, isZeroCost, unitCostFromTotal } from "@/lib/money";
import {
  formatQuantity,
  fromMilli,
  parseQuantityInput,
  quantityInputText,
  toMilli,
} from "@/lib/quantity";
import { stockState, stockStatus } from "@/modules/inventory/status";

describe("quantities (numeric(14,3) as thousandths)", () => {
  it.each([
    ["3250.000", 3_250_000],
    ["0.5", 500],
    ["12", 12_000],
    ["-2.000", -2000],
    ["-0.000", 0],
    ["99999999999.999", 99_999_999_999_999],
  ])("toMilli(%s) = %d", (text, milli) => {
    expect(toMilli(text)).toBe(milli);
  });

  it.each(["", "1,5", "1.2345", "abc", "123456789012"])(
    "toMilli refuses %j",
    (text) => {
      expect(() => toMilli(text)).toThrow(RangeError);
    },
  );

  it.each([
    [3_250_000, "3250.000"],
    [500, "0.500"],
    [-2000, "-2.000"],
    [0, "0.000"],
  ])("fromMilli(%d) = %s", (milli, text) => {
    expect(fromMilli(milli)).toBe(text);
    expect(toMilli(fromMilli(milli))).toBe(milli);
  });

  it("fromMilli refuses fractions and out-of-range values", () => {
    expect(() => fromMilli(1.5)).toThrow(RangeError);
    expect(() => fromMilli(100_000_000_000_000)).toThrow(RangeError);
  });

  it.each([
    [3_250_000, "3.250"],
    [18_000_000, "18.000"],
    [500, "0,5"],
    [1_250_750, "1.250,75"],
    [-2000, "−2"],
    [0, "0"],
  ])("formatQuantity(%d) = %s", (milli, text) => {
    expect(formatQuantity(milli)).toBe(text);
  });

  it.each([
    ["3.250", 3_250_000],
    ["3250", 3_250_000],
    ["0,5", 500],
    ["1.250,75", 1_250_750],
    [" 12 ", 12_000],
    ["0", 0],
  ])("parseQuantityInput(%j) = %d", (text, milli) => {
    expect(parseQuantityInput(text)).toBe(milli);
  });

  it.each(["", "1.5", "1,2345", "-2", "12.34.5", "abc", "1.000.0000"])(
    "parseQuantityInput refuses %j",
    (text) => {
      expect(parseQuantityInput(text)).toBeNull();
    },
  );

  it("quantityInputText gives text the parser reads back", () => {
    for (const milli of [3_250_000, 500, 1_250_750, 0]) {
      expect(parseQuantityInput(quantityInputText(milli))).toBe(milli);
    }
  });
});

describe("unit cost (avg_cost, numeric(14,4))", () => {
  it.each([
    // total rupiah, quantity in thousandths, cost per unit
    [926_250, 3_250_000, "285.0000"], // 3.250 g of beans for Rp 926.250
    [32_220, 1_800_000, "17.9000"],
    [100, 3000, "33.3333"], // 33.3333…
    [200, 3000, "66.6667"], // 66.6666… rounds half-up
    [132_000, 12_000, "11000.0000"],
    [1, 1, "1000.0000"], // 0,001 unit for Rp 1
    [100_000_000, 1, "100000000000.0000"],
  ])("unitCostFromTotal(%d, %d) = %s", (total, milli, cost) => {
    expect(unitCostFromTotal(total, milli)).toBe(cost);
  });

  it("refuses a zero or fractional quantity and a negative total", () => {
    expect(() => unitCostFromTotal(100, 0)).toThrow(RangeError);
    expect(() => unitCostFromTotal(100, 1.5)).toThrow(RangeError);
    expect(() => unitCostFromTotal(-1, 1000)).toThrow(RangeError);
  });

  it.each([
    ["285.0000", "Rp 285,00"],
    ["17.9000", "Rp 17,90"],
    ["17.9550", "Rp 17,96"], // half-up for display
    ["11000", "Rp 11.000,00"],
    ["0.0049", "Rp 0,00"],
  ])("formatUnitCost(%s) = %s", (cost, text) => {
    expect(formatUnitCost(cost)).toBe(text);
  });

  it("isZeroCost", () => {
    expect(isZeroCost("0.0000")).toBe(true);
    expect(isZeroCost("0")).toBe(true);
    expect(isZeroCost("0.0001")).toBe(false);
    expect(isZeroCost("285.0000")).toBe(false);
  });
});

describe("O-05 status chip", () => {
  const status = (stock: number, min: number, hasCost = true) =>
    stockStatus({ stockMilli: stock, minMilli: min, hasCost });

  it("puts stock first: minus, habis, menipis, then the missing cost", () => {
    expect(status(-2000, 20_000, false)).toBe("minus");
    expect(status(0, 500_000, false)).toBe("empty");
    expect(status(0, 0)).toBe("empty");
    expect(status(600_000, 1_000_000, false)).toBe("low");
    expect(status(1_000_000, 1_000_000)).toBe("low"); // at the minimum
    expect(status(200_000, 50_000, false)).toBe("no_cost");
    expect(status(3_250_000, 1_000_000)).toBe("ok");
    expect(status(1, 0)).toBe("ok");
  });

  it("counts an ingredient without cost as Aman in the summary", () => {
    expect(stockState("no_cost")).toBe("ok");
    expect(stockState("low")).toBe("low");
  });
});
