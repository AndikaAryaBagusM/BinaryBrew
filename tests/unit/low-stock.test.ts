import { describe, expect, it } from "vitest";
import {
  compareLow,
  crossedToLow,
  lowStatus,
} from "@/modules/inventory/status";

// P2-07 (FR-IV-06, A13): low means at or below the minimum, Habis and Minus
// included; stock.low fires only when a sale crosses into it.

describe("lowStatus", () => {
  it.each([
    [2_001, 2_000, null],
    [2_000, 2_000, "low"],
    [1_800, 2_000, "low"],
    [0, 2_000, "empty"],
    [0, 0, "empty"],
    [1, 0, null],
    [-2_000, 500, "minus"],
  ])("stock %i, minimum %i → %s", (stock, min, expected) => {
    expect(lowStatus(stock, min)).toBe(expected);
  });
});

describe("crossedToLow", () => {
  const min = 500_000;
  it.each([
    [600_000, 500_000, true], // to exactly the minimum
    [600_000, 100_000, true],
    [600_000, -50_000, true], // straight into Minus
    [600_000, 500_001, false], // still above
    [500_000, 400_000, false], // already low: no second alert
    [0, -10_000, false],
  ])("%i → %i: %s", (beforeMilli, afterMilli, expected) => {
    expect(crossedToLow({ beforeMilli, afterMilli, minMilli: min })).toBe(
      expected,
    );
  });

  it("counts reaching zero with a zero minimum", () => {
    expect(
      crossedToLow({ beforeMilli: 1_000, afterMilli: 0, minMilli: 0 }),
    ).toBe(true);
  });
});

describe("compareLow", () => {
  it("puts Minus first, then Habis, then Menipis, each by name", () => {
    const rows = [
      { name: "Susu UHT", status: "low" as const },
      { name: "Teh celup", status: "minus" as const },
      { name: "Es krim vanila", status: "empty" as const },
      { name: "Gula aren cair", status: "low" as const },
    ];
    expect([...rows].sort(compareLow).map((row) => row.name)).toEqual([
      "Teh celup",
      "Es krim vanila",
      "Gula aren cair",
      "Susu UHT",
    ]);
  });
});
