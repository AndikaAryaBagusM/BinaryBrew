import { describe, expect, it } from "vitest";
import {
  lineStockNeeds,
  orderStockNeeds,
  scaleNeeds,
  type StockItem,
  stockShortfalls,
  unitStockNeeds,
} from "@/modules/orders/stock";

// P2-03 (FR-IV-04, Schema §5.1 step 4): what an order takes from stock.

const latte: StockItem = {
  id: "latte",
  name: "Latte",
  recipe: [
    { ingredientId: "beans", qty: "18.000" },
    { ingredientId: "milk", qty: "150.000" },
    { ingredientId: "cup", qty: "1.000" },
  ],
  modifierGroups: [
    {
      options: [
        {
          id: "shot",
          ingredientDeltas: [{ ingredientId: "beans", qtyDelta: "9.000" }],
        },
        {
          id: "oat",
          ingredientDeltas: [
            { ingredientId: "oat", qtyDelta: "150.000" },
            { ingredientId: "milk", qtyDelta: "-150.000" },
          ],
        },
        { id: "less-sugar", ingredientDeltas: [] },
      ],
    },
  ],
};

const americano: StockItem = {
  id: "americano",
  name: "Americano",
  recipe: [
    { ingredientId: "beans", qty: "18.000" },
    { ingredientId: "cup", qty: "1.000" },
  ],
  // Offers the same group, so it can take Susu oat.
  modifierGroups: latte.modifierGroups,
};

const croissant: StockItem = {
  id: "croissant",
  name: "Croissant",
  recipe: [],
  modifierGroups: [],
};

const items = [latte, americano, croissant];
const line = (
  menuItemId: string,
  quantity = 1,
  modifierOptionIds: string[] = [],
) => ({ menuItemId, quantity, modifierOptionIds });

describe("lineStockNeeds", () => {
  it("is the recipe times the quantity", () => {
    expect(lineStockNeeds(line("latte", 2), latte)).toEqual(
      new Map([
        ["beans", 36_000],
        ["milk", 300_000],
        ["cup", 2000],
      ]),
    );
  });

  it("adds the chosen options' deltas and ignores the others", () => {
    expect(lineStockNeeds(line("latte", 1, ["shot"]), latte).get("beans")).toBe(
      27_000,
    );
    // Oat milk replaces UHT: no milk left, 150 ml of oat.
    const oat = lineStockNeeds(line("latte", 3, ["oat"]), latte);
    expect(oat.get("oat")).toBe(450_000);
    expect(oat.has("milk")).toBe(false);
  });

  it("never needs less than nothing", () => {
    // Americano has no milk: "-150 ml UHT" frees nothing.
    expect(
      lineStockNeeds(line("americano", 1, ["oat"]), americano).has("milk"),
    ).toBe(false);
  });

  it("is empty for an item without a recipe", () => {
    expect(lineStockNeeds(line("croissant", 4), croissant).size).toBe(0);
  });
});

describe("orderStockNeeds", () => {
  it("sums the lines per ingredient and skips unknown items", () => {
    expect(
      orderStockNeeds(
        [line("latte", 1, ["shot"]), line("americano", 2), line("gone", 5)],
        items,
      ),
    ).toEqual(
      new Map([
        ["beans", 27_000 + 36_000],
        ["milk", 150_000],
        ["cup", 3000],
      ]),
    );
  });
});

describe("stockShortfalls", () => {
  const stock = new Map([
    ["beans", 60_000],
    ["milk", 300_000],
    ["cup", 100_000],
    ["oat", 0],
  ]);

  it("is empty when the order fits, including exactly", () => {
    expect(stockShortfalls([line("latte", 2)], items, stock)).toEqual([]);
    expect(
      stockShortfalls(
        [line("latte", 1, ["shot"]), line("americano", 1)],
        items,
        new Map([...stock, ["beans", 45_000]]),
      ),
    ).toEqual([]);
  });

  it("names every item using an ingredient the order runs out of", () => {
    // 3 × 18 + 9 = 63 g of beans, 60 g in stock.
    expect(
      stockShortfalls(
        [line("latte", 1, ["shot"]), line("croissant"), line("americano", 2)],
        items,
        stock,
      ),
    ).toEqual([
      { menuItemId: "latte", name: "Latte" },
      { menuItemId: "americano", name: "Americano" },
    ]);
  });

  it("names an item once, in request order", () => {
    expect(
      stockShortfalls(
        [line("latte", 2), line("latte", 1, ["shot"])],
        items,
        stock,
      ),
    ).toEqual([{ menuItemId: "latte", name: "Latte" }]);
  });

  it("does not let an option's minus free stock for another line", () => {
    // Latte ×3 needs 450 ml of milk (300 in stock). Without the clamp the
    // Americano's oat option would bring it down to 300.
    expect(
      stockShortfalls(
        [line("latte", 3), line("americano", 1, ["less-sugar", "oat"])],
        items,
        new Map([...stock, ["beans", 1_000_000], ["oat", 1_000_000]]),
      ),
    ).toEqual([{ menuItemId: "latte", name: "Latte" }]);
  });

  it("treats an ingredient without a stock level as empty", () => {
    expect(
      stockShortfalls([line("latte", 1, ["oat"])], items, new Map()),
    ).toEqual([{ menuItemId: "latte", name: "Latte" }]);
  });

  it("refuses when stock is already negative", () => {
    expect(
      stockShortfalls(
        [line("americano")],
        items,
        new Map([...stock, ["beans", -5000]]),
      ),
    ).toEqual([{ menuItemId: "americano", name: "Americano" }]);
  });
});

describe("unitStockNeeds (payment, P2-04)", () => {
  it("adds a snapshot of deltas to the recipe and drops what is not needed", () => {
    expect(
      unitStockNeeds(latte.recipe, [
        { ingredientId: "beans", qtyDelta: "9.000" },
        { ingredientId: "oat", qtyDelta: "150.000" },
        { ingredientId: "milk", qtyDelta: "-150.000" },
      ]),
    ).toEqual(
      new Map([
        ["beans", 27_000],
        ["cup", 1000],
        ["oat", 150_000],
      ]),
    );
  });

  it("needs only the deltas for an item without a recipe", () => {
    expect(
      unitStockNeeds([], [{ ingredientId: "ice", qtyDelta: "50.000" }]),
    ).toEqual(new Map([["ice", 50_000]]));
  });

  it("scales a unit need by the quantity", () => {
    expect(scaleNeeds(new Map([["beans", 18_000]]), 20)).toEqual(
      new Map([["beans", 360_000]]),
    );
  });
});
