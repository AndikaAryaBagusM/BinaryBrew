import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";
import {
  averagePermille,
  formatPermille,
  formatSignedRupiah,
  marginPermille,
} from "@/lib/money";
import { formatMonth } from "@/lib/time";
import { type ItemCost, itemCost } from "@/modules/menu/cost";
import {
  hppRows,
  hppSummary,
  monthRange,
  reportMonths,
  salesRows,
} from "@/modules/reports/hpp";

// P2-06 (FR-HP-01, 02, 04): HPP per item, margin, the low-margin flag and
// the O-09 report pieces, without a database.

describe("itemCost (FR-HP-01)", () => {
  const costs = new Map([
    ["beans", "285.0000"],
    ["milk", "17.9000"],
    ["syrup", "0.0000"],
  ]);

  it("sums quantity × average cost and rounds once", () => {
    // 18 × 285 + 200 × 17,9 = 5.130 + 3.580 = 8.710
    expect(
      itemCost(
        [
          { ingredientId: "beans", qty: "18" },
          { ingredientId: "milk", qty: "200" },
        ],
        costs,
      ),
    ).toEqual({ status: "complete", hpp: 8710 });
    // 0,5 × 17,9 = 8,95 → 9 (half-up once)
    expect(itemCost([{ ingredientId: "milk", qty: "0.5" }], costs)).toEqual({
      status: "complete",
      hpp: 9,
    });
  });

  it("is incomplete when an ingredient has no cost yet (counted as 0)", () => {
    expect(
      itemCost(
        [
          { ingredientId: "beans", qty: "18" },
          { ingredientId: "syrup", qty: "20" },
        ],
        costs,
      ),
    ).toEqual({ status: "incomplete", hpp: 5130 });
  });

  it("has no HPP without a recipe (unknown, not zero)", () => {
    expect(itemCost([], costs)).toEqual({ status: "no_recipe", hpp: null });
  });
});

describe("margin percentages", () => {
  it.each([
    [22_000, 10_164, 538, "53,8%"],
    [28_000, 21_100, 246, "24,6%"],
    [10_000, 12_345, -235, "−23,5%"], // −23,45 → away from zero
    [3, 2, 333, "33,3%"],
  ])("%i − %i → %i (%s)", (price, hpp, permille, text) => {
    expect(marginPermille(price, hpp)).toBe(permille);
    expect(formatPermille(permille)).toBe(text);
  });

  it("is null for a free item", () => {
    expect(marginPermille(0, 100)).toBeNull();
  });

  it("averages half-up away from zero", () => {
    expect(averagePermille([538, 246, 400])).toBe(395); // 394,67
    expect(averagePermille([-5, -6])).toBe(-6); // −5,5
    expect(averagePermille([])).toBeNull();
  });

  it("writes a negative amount with a true minus", () => {
    expect(formatSignedRupiah(-6900)).toBe("−Rp 6.900");
  });
});

describe("hppRows and hppSummary (O-09)", () => {
  const items = [
    { id: "a", name: "Americano", price: 18_000 },
    { id: "s", name: "Sandwich Ayam", price: 28_000 },
    { id: "k", name: "Kentang Goreng", price: 20_000 },
    { id: "l", name: "Latte", price: 24_000 },
    { id: "b", name: "Brownie", price: 10_000 },
  ];
  const costs = new Map<string, ItemCost>([
    ["a", { status: "complete", hpp: 6330 }],
    ["s", { status: "complete", hpp: 21_100 }],
    ["l", { status: "incomplete", hpp: 9870 }],
    ["b", { status: "complete", hpp: 7000 }], // exactly 30,0 %
  ]);

  it("sorts by margin %, lowest first, items without a recipe last", () => {
    const rows = hppRows(items, costs, 30);
    expect(rows.map((row) => [row.name, row.marginPermille])).toEqual([
      ["Sandwich Ayam", 246],
      ["Brownie", 300],
      ["Latte", 589],
      ["Americano", 648],
      ["Kentang Goreng", null],
    ]);
    expect(rows[0]).toEqual({
      id: "s",
      name: "Sandwich Ayam",
      price: 28_000,
      status: "complete",
      hpp: 21_100,
      margin: 6900,
      marginPermille: 246,
      lowMargin: true,
    });
    expect(rows.at(-1)).toMatchObject({
      status: "no_recipe",
      hpp: null,
      margin: null,
      lowMargin: false,
    });
  });

  it("flags below the threshold only: 30,0 % at a 30 % limit is not low", () => {
    const rows = hppRows(items, costs, 30);
    expect(rows.filter((row) => row.lowMargin).map((row) => row.id)).toEqual([
      "s",
    ]);
    expect(
      hppRows(items, costs, 30.1)
        .filter((row) => row.lowMargin)
        .map((row) => row.id),
    ).toEqual(["s", "b"]);
  });

  it("summarises the cards", () => {
    expect(hppSummary(hppRows(items, costs, 30))).toEqual({
      averagePermille: 446, // (246 + 300 + 589 + 648) / 4 = 445,75
      withRecipe: 4,
      lowMargin: 1,
      incomplete: 1,
    });
  });
});

describe("salesRows (FR-HP-04)", () => {
  it("adds margin per item and in total, most sold first", () => {
    const { rows, totals } = salesRows(
      [
        {
          menuItemId: "a",
          quantity: 3,
          revenue: 54_000,
          cogs: 18_990,
          uncostedQuantity: 0,
        },
        {
          menuItemId: "k",
          quantity: 5,
          revenue: 100_000,
          cogs: 0,
          uncostedQuantity: 5,
        },
      ],
      new Map([
        ["a", "Americano"],
        ["k", "Kentang Goreng"],
      ]),
    );
    expect(rows).toEqual([
      {
        menuItemId: "k",
        name: "Kentang Goreng",
        quantity: 5,
        revenue: 100_000,
        cogs: 0,
        uncostedQuantity: 5,
        margin: null,
        marginPermille: null,
      },
      {
        menuItemId: "a",
        name: "Americano",
        quantity: 3,
        revenue: 54_000,
        cogs: 18_990,
        uncostedQuantity: 0,
        margin: 35_010,
        marginPermille: 648,
      },
    ]);
    // Portions without HPP make the total margin unknown too.
    expect(totals).toEqual({
      quantity: 8,
      revenue: 154_000,
      cogs: 18_990,
      uncostedQuantity: 5,
      margin: null,
      marginPermille: null,
    });
  });
});

describe("months", () => {
  it("gives a month's first and last day", () => {
    expect(monthRange("2028-02")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
    expect(monthRange("2026-12")).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });

  it("offers the current month back to the first sale, newest first", () => {
    expect(reportMonths("2026-02", "2025-11-15")).toEqual([
      "2026-02",
      "2026-01",
      "2025-12",
      "2025-11",
    ]);
    expect(reportMonths("2026-02", null)).toEqual(["2026-02"]);
    // Only sales dated after today (test clocks): still the current month.
    expect(reportMonths("2026-02", "2100-01-01")).toEqual(["2026-02"]);
    expect(reportMonths("2026-02", "2020-01-01", 3)).toEqual([
      "2026-02",
      "2026-01",
      "2025-12",
    ]);
  });

  it("names a month in Indonesian", () => {
    expect(formatMonth("2026-10")).toBe("Oktober 2026");
  });
});

describe("toCsv", () => {
  it("quotes where needed and neutralises formulas", () => {
    expect(
      toCsv([
        ["Menu", "Harga", "Catatan"],
        ['Kopi "Susu", Aren', 22_000, null],
        ["=HYPERLINK(1)", -5, "baris\nbaru"],
      ]),
    ).toBe(
      'Menu,Harga,Catatan\r\n"Kopi ""Susu"", Aren",22000,\r\n\'=HYPERLINK(1),-5,"baris\nbaru"',
    );
  });
});
