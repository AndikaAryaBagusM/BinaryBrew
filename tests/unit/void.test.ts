import { describe, expect, it } from "vitest";
import { voidMovements } from "@/modules/inventory/void";
import { orderSearch } from "@/modules/orders/search";
import { voidReasonText } from "@/modules/orders/void-reasons";

// P3-01 (FR-IV-09, BR-08, Schema §5.4): what a void moves, the reason text
// it keeps, and the O-12 search.

describe("voidMovements", () => {
  const taken = [
    { ingredientId: "a", qtyDelta: "-36.000" },
    { ingredientId: "b", qtyDelta: "-0.500" },
  ];

  it("returns what the sale took when preparation had not started", () => {
    expect(voidMovements(taken, false)).toEqual([
      { ingredientId: "a", type: "void_return", qtyDelta: "36.000" },
      { ingredientId: "b", type: "void_return", qtyDelta: "0.500" },
    ]);
  });

  it("returns it and logs the same amount as waste once preparation started", () => {
    expect(voidMovements(taken, true)).toEqual([
      { ingredientId: "a", type: "void_return", qtyDelta: "36.000" },
      { ingredientId: "a", type: "waste", qtyDelta: "-36.000" },
      { ingredientId: "b", type: "void_return", qtyDelta: "0.500" },
      { ingredientId: "b", type: "waste", qtyDelta: "-0.500" },
    ]);
  });

  it("moves nothing when nothing was taken", () => {
    expect(voidMovements([], true)).toEqual([]);
    expect(
      voidMovements([{ ingredientId: "a", qtyDelta: "0.000" }], true),
    ).toEqual([]);
  });
});

describe("voidReasonText", () => {
  it.each([
    ["changed_mind", undefined, "Pelanggan berubah pikiran"],
    ["wrong_order", "  ", "Pesanan salah input"],
    ["cannot_make", "Susu habis", "Menu tidak bisa dibuat · Susu habis"],
    ["double_payment", undefined, "Pembayaran ganda"],
    ["other", " Tumpah ", "Tumpah"],
    ["other", undefined, ""],
  ] as const)("%s + %j → %j", (reason, note, text) => {
    expect(voidReasonText(reason, note)).toBe(text);
  });
});

describe("orderSearch", () => {
  it("matches the queue number written either way", () => {
    for (const q of ["12", "#012", " 012 "]) {
      const match = orderSearch(q);
      expect(match(12, [null])).toBe(true);
      expect(match(120, [null])).toBe(false);
      expect(match(null, [null])).toBe(false);
    }
  });

  it("matches part of a reference in any case", () => {
    const match = orderSearch("9c21");
    expect(match(null, ["mock_9C21D4"])).toBe(true);
    expect(match(null, [null, "RFD-1"])).toBe(false);
    expect(orderSearch("12")(5, ["ref-0012"])).toBe(true);
  });

  it("keeps everything without a search", () => {
    expect(orderSearch(undefined)(null, [])).toBe(true);
    expect(orderSearch("  ")(1, [])).toBe(true);
  });
});
