import { describe, expect, it } from "vitest";
import {
  formatMargin,
  lineCost,
  parsePriceDeltaInput,
  recipeCost,
} from "@/lib/money";
import { formatQuantityDelta, parseSignedQuantityInput } from "@/lib/quantity";
import {
  itemGroupsBody,
  modifierGroupBody,
  modifierGroupPatch,
  modifierOptionBody,
  recipeBody,
} from "@/modules/menu/schemas";
import { cheapestUnitPrice } from "@/modules/orders/pricing";

// P2-02: the O-06 HPP preview, the negative-price guard and the request
// schemas.

const milli = (units: number) => Math.round(units * 1000);

describe("lineCost / recipeCost (O-06 preview)", () => {
  // The Kopi Susu Gula Aren recipe of Figma O-06.
  const recipe = [
    { quantityMilli: milli(18), avgCost: "285.0000" },
    { quantityMilli: milli(150), avgCost: "17.9600" },
    { quantityMilli: milli(20), avgCost: "45.0000" },
    { quantityMilli: milli(120), avgCost: "2.0000" },
    { quantityMilli: milli(1), avgCost: "1200.0000" },
    { quantityMilli: milli(1), avgCost: "0.0000" }, // no cost yet
  ];

  it("prices each line in whole rupiah", () => {
    expect(recipe.map(lineCost)).toEqual([5130, 2694, 900, 240, 1200, 0]);
  });

  it("sums the exact line costs and rounds once", () => {
    expect(recipeCost(recipe)).toBe(10_164);
    // 3 × 0.4 rupiah: each line rounds to 0, the total to 1.
    const tiny = { quantityMilli: 1, avgCost: "400.0000" };
    expect(lineCost(tiny)).toBe(0);
    expect(recipeCost([tiny, tiny, tiny])).toBe(1);
  });

  it("rounds half-up", () => {
    expect(lineCost({ quantityMilli: 500, avgCost: "1.0000" })).toBe(1);
    expect(lineCost({ quantityMilli: 499, avgCost: "1.0000" })).toBe(0);
    expect(lineCost({ quantityMilli: 250, avgCost: "17.9000" })).toBe(4); // 4.475
  });

  it("is zero for an empty recipe", () => {
    expect(recipeCost([])).toBe(0);
  });

  it("refuses a negative quantity or a bad cost", () => {
    expect(() => lineCost({ quantityMilli: -1, avgCost: "1" })).toThrow(
      RangeError,
    );
    expect(() => lineCost({ quantityMilli: 1, avgCost: "abc" })).toThrow(
      RangeError,
    );
  });
});

describe("formatMargin", () => {
  it("shows the margin and its share of the price", () => {
    expect(formatMargin(22_000, 10_164)).toBe("Rp 11.836 · 53,8%");
    expect(formatMargin(20_000, 0)).toBe("Rp 20.000 · 100,0%");
  });

  it("marks a loss with a minus sign", () => {
    expect(formatMargin(10_000, 12_000)).toBe("−Rp 2.000 · −20,0%");
  });

  it("leaves out the percentage for a free item", () => {
    expect(formatMargin(0, 500)).toBe("−Rp 500");
  });
});

describe("cheapestUnitPrice", () => {
  const group = (minSelect: number, maxSelect: number, deltas: number[]) => ({
    minSelect,
    maxSelect,
    options: deltas.map((priceDelta) => ({ priceDelta })),
  });

  it("is the base price without groups", () => {
    expect(cheapestUnitPrice({ price: 18_000, modifierGroups: [] })).toBe(
      18_000,
    );
  });

  it("takes the cheapest required option", () => {
    // Ukuran: Regular 0 or Large +5000, pick exactly one.
    expect(
      cheapestUnitPrice({
        price: 22_000,
        modifierGroups: [group(1, 1, [5000, 0])],
      }),
    ).toBe(22_000);
    expect(
      cheapestUnitPrice({
        price: 22_000,
        modifierGroups: [group(1, 1, [5000, 2000])],
      }),
    ).toBe(24_000);
  });

  it("adds optional discounts up to the maximum", () => {
    expect(
      cheapestUnitPrice({
        price: 10_000,
        modifierGroups: [group(0, 2, [-3000, -2000, -1000, 4000])],
      }),
    ).toBe(5000);
  });

  it("skips optional surcharges", () => {
    expect(
      cheapestUnitPrice({
        price: 10_000,
        modifierGroups: [group(0, 2, [5000, 6000])],
      }),
    ).toBe(10_000);
  });

  it("can go below zero", () => {
    expect(
      cheapestUnitPrice({
        price: 2000,
        modifierGroups: [group(1, 1, [-3000, 0]), group(0, 1, [-500])],
      }),
    ).toBe(-1500);
  });
});

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe("recipeBody", () => {
  it("accepts quantities in base units with up to 3 decimals", () => {
    expect(
      recipeBody.parse({
        lines: [
          { ingredientId: id(1), qty: "18" },
          { ingredientId: id(2), qty: "0.25" },
        ],
      }).lines,
    ).toHaveLength(2);
    expect(recipeBody.parse({ lines: [] }).lines).toEqual([]);
  });

  it("refuses zero, negative, 4 decimals and duplicates", () => {
    for (const qty of ["0", "-1", "1.2345", "1e3", ""]) {
      expect(
        recipeBody.safeParse({ lines: [{ ingredientId: id(1), qty }] }).success,
        qty,
      ).toBe(false);
    }
    expect(
      recipeBody.safeParse({
        lines: [
          { ingredientId: id(1), qty: "1" },
          { ingredientId: id(1), qty: "2" },
        ],
      }).success,
    ).toBe(false);
  });

  it("allows at most 30 lines", () => {
    const lines = Array.from({ length: 31 }, (_, n) => ({
      ingredientId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      qty: "1",
    }));
    expect(recipeBody.safeParse({ lines }).success).toBe(false);
    expect(recipeBody.safeParse({ lines: lines.slice(0, 30) }).success).toBe(
      true,
    );
  });
});

describe("modifier schemas", () => {
  it("refuses a group whose minimum is above its maximum", () => {
    expect(
      modifierGroupBody.safeParse({ name: "X", minSelect: 2, maxSelect: 1 })
        .success,
    ).toBe(false);
    expect(modifierGroupBody.parse({ name: " Topping " })).toEqual({
      name: "Topping",
      minSelect: 0,
      maxSelect: 1,
      isActive: true,
    });
    expect(modifierGroupPatch.safeParse({}).success).toBe(false);
    expect(modifierGroupPatch.safeParse({ maxSelect: 0 }).success).toBe(false);
  });

  it("accepts signed, non-zero ingredient deltas once per ingredient", () => {
    const option = modifierOptionBody.parse({
      name: "Susu oat",
      priceDelta: 6000,
      ingredientDeltas: [
        { ingredientId: id(1), qtyDelta: "150" },
        { ingredientId: id(2), qtyDelta: "-150" },
      ],
    });
    expect(option).toMatchObject({ isDefault: false, isActive: true });
    for (const qtyDelta of ["0", "-0.000", "1.2345"]) {
      expect(
        modifierOptionBody.safeParse({
          name: "X",
          ingredientDeltas: [{ ingredientId: id(1), qtyDelta }],
        }).success,
        qtyDelta,
      ).toBe(false);
    }
    expect(
      modifierOptionBody.safeParse({
        name: "X",
        ingredientDeltas: [
          { ingredientId: id(1), qtyDelta: "1" },
          { ingredientId: id(1), qtyDelta: "2" },
        ],
      }).success,
    ).toBe(false);
  });

  it("allows a negative option price, but whole rupiah only", () => {
    expect(
      modifierOptionBody.safeParse({ name: "Small", priceDelta: -2000 })
        .success,
    ).toBe(true);
    expect(
      modifierOptionBody.safeParse({ name: "Small", priceDelta: 1.5 }).success,
    ).toBe(false);
  });

  it("refuses the same group twice on an item", () => {
    expect(itemGroupsBody.safeParse({ groupIds: [id(1), id(1)] }).success).toBe(
      false,
    );
    expect(itemGroupsBody.parse({ groupIds: [] })).toEqual({ groupIds: [] });
  });
});

describe("O-04 signed inputs", () => {
  it("reads a price change with an optional minus", () => {
    expect(parsePriceDeltaInput("5.000")).toBe(5000);
    expect(parsePriceDeltaInput("-2.000")).toBe(-2000);
    expect(parsePriceDeltaInput("−2000")).toBe(-2000);
    expect(parsePriceDeltaInput(" - Rp 1.500 ")).toBe(-1500);
    expect(parsePriceDeltaInput("0")).toBe(0);
    expect(parsePriceDeltaInput("-0")).toBe(0);
    expect(parsePriceDeltaInput("")).toBeNull();
    expect(parsePriceDeltaInput("--5")).toBeNull();
    expect(parsePriceDeltaInput("1,5")).toBeNull();
  });

  it("reads an ingredient delta with an optional minus", () => {
    expect(parseSignedQuantityInput("9")).toBe(9000);
    expect(parseSignedQuantityInput("-150")).toBe(-150000);
    expect(parseSignedQuantityInput("−0,5")).toBe(-500);
    expect(parseSignedQuantityInput("1.000")).toBe(1_000_000);
    expect(parseSignedQuantityInput("-0")).toBe(0);
    expect(parseSignedQuantityInput("1.5")).toBeNull();
    expect(parseSignedQuantityInput("abc")).toBeNull();
  });

  it("formats a delta with its sign", () => {
    expect(formatQuantityDelta(9000)).toBe("+9");
    expect(formatQuantityDelta(-150000)).toBe("−150");
    expect(formatQuantityDelta(500)).toBe("+0,5");
  });
});
