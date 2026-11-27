import { describe, expect, it } from "vitest";
import {
  compareCost,
  unitCostFromTotal,
  weightedAverageCost,
} from "@/lib/money";
import { previewRestocks } from "@/modules/inventory/restock-preview";
import { restockBody } from "@/modules/inventory/schemas";

// P2-05 (FR-IV-05, BR-09, Schema §5.5): the weighted-average cost after a
// restock, and what a restock save may contain.

const g = (units: number) => Math.round(units * 1000);

describe("weightedAverageCost", () => {
  it("averages stock on hand with the purchase (Figma O-07 rows)", () => {
    // 4.200 ml at Rp 17,90 + 6.000 ml for Rp 108.000 → Rp 17,9588 / ml.
    expect(
      weightedAverageCost(
        { stockMilli: g(4200), avgCost: "17.9000" },
        { quantityMilli: g(6000), totalCost: 108_000 },
      ),
    ).toBe("17.9588");
    // 3.250 g at Rp 285 + 1.000 g for Rp 300.000 → Rp 288,5294 / g.
    expect(
      weightedAverageCost(
        { stockMilli: g(3250), avgCost: "285.0000" },
        { quantityMilli: g(1000), totalCost: 300_000 },
      ),
    ).toBe("288.5294");
  });

  it("keeps the average when the purchase costs the same", () => {
    expect(
      weightedAverageCost(
        { stockMilli: g(20), avgCost: "11000.0000" },
        { quantityMilli: g(12), totalCost: 132_000 },
      ),
    ).toBe("11000.0000");
  });

  it.each([
    ["zero", 0],
    ["negative", g(-16)],
  ])(
    "uses the purchase price when stock is %s (BR-09)",
    (_label, stockMilli) => {
      expect(
        weightedAverageCost(
          { stockMilli, avgCost: "285.0000" },
          { quantityMilli: g(1000), totalCost: 300_000 },
        ),
      ).toBe("300.0000");
    },
  );

  it("uses the exact total, not the rounded unit price", () => {
    // 3 g for Rp 10: Rp 3,3333 / g rounded; three of them is Rp 10 exactly.
    expect(unitCostFromTotal(10, g(3))).toBe("3.3333");
    expect(
      weightedAverageCost(
        { stockMilli: g(3), avgCost: "3.3333" },
        { quantityMilli: g(3), totalCost: 10 },
      ),
    ).toBe("3.3333");
    // (0,5 g × 1 + Rp 2) / 1 g = Rp 2,5; half-up at the 4th decimal.
    expect(
      weightedAverageCost(
        { stockMilli: 500, avgCost: "1.0000" },
        { quantityMilli: 500, totalCost: 2 },
      ),
    ).toBe("2.5000");
    expect(
      weightedAverageCost(
        { stockMilli: g(2), avgCost: "0.0001" },
        { quantityMilli: g(1), totalCost: 0 },
      ),
    ).toBe("0.0001"); // 0,0000666… → half-up
  });

  it("lowers the average for a free delivery and starts from no cost", () => {
    expect(
      weightedAverageCost(
        { stockMilli: g(100), avgCost: "10.0000" },
        { quantityMilli: g(100), totalCost: 0 },
      ),
    ).toBe("5.0000");
    expect(
      weightedAverageCost(
        { stockMilli: g(100), avgCost: "0.0000" },
        { quantityMilli: g(100), totalCost: 1000 },
      ),
    ).toBe("5.0000");
  });

  it("refuses a quantity that is not positive", () => {
    expect(() =>
      weightedAverageCost(
        { stockMilli: 0, avgCost: "0" },
        { quantityMilli: 0, totalCost: 1 },
      ),
    ).toThrow(RangeError);
  });
});

describe("compareCost", () => {
  it("compares decimal costs exactly", () => {
    expect(compareCost("17.9588", "17.9000")).toBe(1);
    expect(compareCost("17.9", "17.9000")).toBe(0);
    expect(compareCost("5", "5.0001")).toBe(-1);
  });
});

describe("restockBody", () => {
  const line = {
    ingredientId: "8c1f6a7e-2f7e-4a55-9d0e-0b6f0e7c1a11",
    quantity: "6000",
    totalCost: 108_000,
  };

  it("takes 1 to 20 lines; supplier and date are optional", () => {
    expect(restockBody.parse({ lines: [line] })).toEqual({
      lines: [{ ...line, supplierId: null, purchasedOn: null }],
    });
    expect(restockBody.safeParse({ lines: [] }).success).toBe(false);
    expect(
      restockBody.safeParse({ lines: Array.from({ length: 21 }, () => line) })
        .success,
    ).toBe(false);
  });

  it.each([
    [{ quantity: "0" }],
    [{ quantity: "-1" }],
    [{ quantity: "1,5" }],
    [{ totalCost: -1 }],
    [{ totalCost: 1.5 }],
    [{ totalCost: 100_000_001 }],
    [{ purchasedOn: "2026-02-30" }],
    [{ purchasedOn: "14 Okt 2026" }],
    [{ supplierId: "toko" }],
    [{ unitCost: 18 }],
  ])("refuses %j", (change) => {
    expect(
      restockBody.safeParse({ lines: [{ ...line, ...change }] }).success,
    ).toBe(false);
  });
});

describe("previewRestocks (S-09, O-07)", () => {
  const milk = { id: "milk", stockQty: "4200.000", avgCost: "17.9000" };
  const beans = { id: "beans", stockQty: "-5.000", avgCost: "285.0000" };

  it("previews each complete line, in order", () => {
    expect(
      previewRestocks(
        [milk, beans],
        [
          { ingredientId: "milk", quantityMilli: g(6000), totalCost: 108_000 },
          { ingredientId: "beans", quantityMilli: g(1000), totalCost: 300_000 },
          { ingredientId: "milk", quantityMilli: g(10_200), totalCost: 0 },
        ],
      ),
    ).toEqual([
      {
        avgCostBefore: "17.9000",
        avgCostAfter: "17.9588",
        stockMilliAfter: g(10_200),
      },
      // Negative stock: the purchase price (BR-09).
      {
        avgCostBefore: "285.0000",
        avgCostAfter: "300.0000",
        stockMilliAfter: g(995),
      },
      // The second milk row starts from the first one's result.
      {
        avgCostBefore: "17.9588",
        avgCostAfter: "8.9794",
        stockMilliAfter: g(20_400),
      },
    ]);
  });

  it("skips incomplete lines without changing later ones", () => {
    const result = previewRestocks(
      [milk],
      [
        { ingredientId: null, quantityMilli: g(1), totalCost: 1 },
        { ingredientId: "milk", quantityMilli: null, totalCost: 1 },
        { ingredientId: "milk", quantityMilli: 0, totalCost: 1 },
        { ingredientId: "milk", quantityMilli: g(1), totalCost: null },
        { ingredientId: "gone", quantityMilli: g(1), totalCost: 1 },
        { ingredientId: "milk", quantityMilli: g(6000), totalCost: 108_000 },
      ],
    );
    expect(result.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(result[5]?.avgCostAfter).toBe("17.9588");
  });
});
