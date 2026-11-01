import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import type { PublicMenuItem } from "@/modules/menu/service";
import {
  type CartLine,
  MAX_LINES,
  MAX_QUANTITY,
  previewLineTotal,
  priceOrder,
  type PricingItem,
  type PricingRates,
  selectionProblems,
} from "@/modules/orders/pricing";

// Pricing (FR-TX-01, FR-CO-03, BR-03, Schema §5.1): the server prices every
// order from the catalog; the client only sends ids, options and quantities.

const size = {
  id: "g-size",
  name: "Ukuran",
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: "o-regular", name: "Regular", priceDelta: 0 },
    { id: "o-large", name: "Large", priceDelta: 5_000 },
  ],
};
const extras = {
  id: "g-extras",
  name: "Tambahan",
  minSelect: 0,
  maxSelect: 2,
  options: [
    { id: "o-shot", name: "Extra shot", priceDelta: 5_000 },
    { id: "o-oat", name: "Susu oat", priceDelta: 6_000 },
    { id: "o-less-sugar", name: "Kurang manis", priceDelta: 0 },
  ],
};
const teaSize = {
  id: "g-tea-size",
  name: "Ukuran",
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: "o-small", name: "Kecil", priceDelta: -2_000 },
    { id: "o-tea-regular", name: "Regular", priceDelta: 0 },
  ],
};

const kopiSusu: PricingItem = {
  id: "i-kopi-susu",
  name: "Kopi Susu Gula Aren",
  price: 22_000,
  modifierGroups: [size, extras],
};
const esTeh: PricingItem = {
  id: "i-es-teh",
  name: "Es Teh Lemon",
  price: 15_000,
  modifierGroups: [teaSize],
};
const croissant: PricingItem = {
  id: "i-croissant",
  name: "Croissant",
  price: 18_000,
  modifierGroups: [],
};
// A catalog mistake: the discount is larger than the price.
const misconfigured: PricingItem = {
  id: "i-air",
  name: "Air Mineral",
  price: 1_000,
  modifierGroups: [
    {
      id: "g-promo",
      name: "Promo",
      minSelect: 0,
      maxSelect: 1,
      options: [{ id: "o-promo", name: "Potongan", priceDelta: -2_000 }],
    },
  ],
};
const catalog = [kopiSusu, esTeh, croissant, misconfigured];

const noTax: PricingRates = {
  taxRateBps: 0,
  taxInclusive: true,
  serviceChargeBps: 0,
};

const line = (
  item: PricingItem,
  quantity = 1,
  modifierOptionIds: string[] = [],
): CartLine => ({ menuItemId: item.id, quantity, modifierOptionIds });

function rejection(lines: CartLine[]): AppError {
  try {
    priceOrder(lines, catalog, noTax);
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected priceOrder to throw");
}

describe("priceOrder: lines", () => {
  it("prices an item without modifiers", () => {
    const order = priceOrder([line(croissant)], catalog, noTax);
    expect(order.lines).toEqual([
      {
        menuItemId: croissant.id,
        name: "Croissant",
        unitPrice: 18_000,
        modifiersTotal: 0,
        quantity: 1,
        lineTotal: 18_000,
        modifiers: [],
      },
    ]);
    expect(order).toMatchObject({ subtotal: 18_000, total: 18_000 });
  });

  it("adds option deltas per unit, then multiplies by quantity", () => {
    const order = priceOrder(
      [line(kopiSusu, 2, ["o-large", "o-shot"])],
      catalog,
      noTax,
    );
    expect(order.lines[0]).toMatchObject({
      unitPrice: 22_000,
      modifiersTotal: 10_000,
      quantity: 2,
      lineTotal: 64_000,
    });
    expect(order.subtotal).toBe(64_000);
  });

  it("accepts a negative modifier delta", () => {
    const order = priceOrder([line(esTeh, 3, ["o-small"])], catalog, noTax);
    expect(order.lines[0]).toMatchObject({
      unitPrice: 15_000,
      modifiersTotal: -2_000,
      lineTotal: 39_000,
    });
  });

  it("snapshots options in catalog order with group names, whatever the client order", () => {
    const order = priceOrder(
      [line(kopiSusu, 1, ["o-less-sugar", "o-shot", "o-regular"])],
      catalog,
      noTax,
    );
    expect(order.lines[0]!.modifiers).toEqual([
      {
        optionId: "o-regular",
        groupName: "Ukuran",
        optionName: "Regular",
        priceDelta: 0,
      },
      {
        optionId: "o-shot",
        groupName: "Tambahan",
        optionName: "Extra shot",
        priceDelta: 5_000,
      },
      {
        optionId: "o-less-sugar",
        groupName: "Tambahan",
        optionName: "Kurang manis",
        priceDelta: 0,
      },
    ]);
  });

  it("keeps two lines of the same item separate and sums the subtotal", () => {
    const order = priceOrder(
      [
        line(kopiSusu, 1, ["o-regular"]),
        line(kopiSusu, 1, ["o-large"]),
        line(croissant, 2),
      ],
      catalog,
      noTax,
    );
    expect(order.lines.map((l) => l.lineTotal)).toEqual([
      22_000, 27_000, 36_000,
    ]);
    expect(order.subtotal).toBe(85_000);
  });

  it("allows the largest order (30 lines of 20)", () => {
    const lines = Array.from({ length: MAX_LINES }, () =>
      line(croissant, MAX_QUANTITY),
    );
    expect(priceOrder(lines, catalog, noTax).subtotal).toBe(30 * 20 * 18_000);
  });
});

describe("priceOrder: input from the public menu", () => {
  it("accepts menu items as P1-03 returns them, so the cart prices like the server", () => {
    const fromMenu: PublicMenuItem = {
      id: "i-latte",
      name: "Latte",
      description: null,
      price: 25_000,
      imageUrl: null,
      isAvailable: true,
      modifierGroups: [
        {
          ...size,
          options: size.options.map((o) => ({
            ...o,
            isDefault: o.id === "o-regular",
          })),
        },
      ],
    };
    const order = priceOrder(
      [line(fromMenu, 1, ["o-large"])],
      [fromMenu],
      noTax,
    );
    expect(order.total).toBe(30_000);
  });
});

describe("priceOrder: service charge and tax (Schema §5.1)", () => {
  // Kopi Susu Regular 22.000 + Croissant 18.000 = 40.000
  const lines = [line(kopiSusu, 1, ["o-regular"]), line(croissant)];

  it.each([
    // [case, rates, serviceCharge, taxAmount, total]
    ["defaults: no tax, no service", noTax, 0, 0, 40_000],
    [
      "11 % inclusive tax",
      { taxRateBps: 1_100, taxInclusive: true, serviceChargeBps: 0 },
      0,
      3_964, // 40000 × 1100 / 11100 = 3963.96
      40_000,
    ],
    [
      "5 % service charge",
      { taxRateBps: 0, taxInclusive: true, serviceChargeBps: 500 },
      2_000,
      0,
      42_000,
    ],
    [
      "5 % service + 11 % inclusive tax on the total",
      { taxRateBps: 1_100, taxInclusive: true, serviceChargeBps: 500 },
      2_000,
      4_162, // 42000 × 1100 / 11100 = 4162.16
      42_000,
    ],
    [
      "11 % tax added on top (tax_inclusive = false)",
      { taxRateBps: 1_100, taxInclusive: false, serviceChargeBps: 500 },
      2_000,
      4_620, // 42000 × 11 %
      46_620,
    ],
  ] as const)("%s", (_case, rates, serviceCharge, taxAmount, total) => {
    const order = priceOrder(lines, catalog, rates);
    expect(order).toMatchObject({
      subtotal: 40_000,
      serviceChargeBps: rates.serviceChargeBps,
      serviceCharge,
      taxRateBps: rates.taxRateBps,
      taxInclusive: rates.taxInclusive,
      taxAmount,
      total,
    });
  });

  it("rounds the service charge half-up on the order subtotal, not per line", () => {
    // 3 × 15.000 = 45.000 at 0.01 % = 4.5 → 5 (per line it would be 2 + 2 + 2)
    const order = priceOrder(
      [
        line(esTeh, 1, ["o-tea-regular"]),
        line(esTeh, 1, ["o-tea-regular"]),
        line(esTeh, 1, ["o-tea-regular"]),
      ],
      catalog,
      { taxRateBps: 0, taxInclusive: true, serviceChargeBps: 1 },
    );
    expect(order.serviceCharge).toBe(5);
  });

  it("matches the orders_total_matches invariant (I3) for every rate combination", () => {
    for (const taxRateBps of [0, 1_000, 1_100]) {
      for (const serviceChargeBps of [0, 500, 1_000]) {
        for (const taxInclusive of [true, false]) {
          const order = priceOrder(lines, catalog, {
            taxRateBps,
            taxInclusive,
            serviceChargeBps,
          });
          expect(order.total).toBe(
            order.subtotal +
              order.serviceCharge +
              (taxInclusive ? 0 : order.taxAmount),
          );
          for (const l of order.lines) {
            expect(l.lineTotal).toBe(
              (l.unitPrice + l.modifiersTotal) * l.quantity,
            ); // I4
          }
        }
      }
    }
  });
});

describe("priceOrder: invalid orders are refused", () => {
  it.each([
    ["an empty order", [], { reason: "empty_order" }],
    [
      "more than 30 lines",
      Array.from({ length: MAX_LINES + 1 }, () => line(croissant)),
      { reason: "too_many_lines" },
    ],
    [
      "quantity 0",
      [line(croissant, 0)],
      { reason: "invalid_quantity", line: 0 },
    ],
    [
      "quantity 21",
      [line(croissant, MAX_QUANTITY + 1)],
      { reason: "invalid_quantity", line: 0 },
    ],
    [
      "a fractional quantity",
      [line(croissant, 1.5)],
      { reason: "invalid_quantity", line: 0 },
    ],
    [
      "an item not on the menu (unknown, inactive or hidden)",
      [
        line(croissant),
        { menuItemId: "i-gone", quantity: 1, modifierOptionIds: [] },
      ],
      { reason: "unknown_item", line: 1 },
    ],
    [
      "an option that belongs to another item",
      [line(croissant, 1, ["o-large"])],
      { reason: "unknown_option", line: 0, optionId: "o-large" },
    ],
    [
      "the same option twice",
      [line(kopiSusu, 1, ["o-regular", "o-shot", "o-shot"])],
      { reason: "duplicate_option", line: 0, optionId: "o-shot" },
    ],
    [
      "a required group left empty",
      [line(kopiSusu, 1, ["o-shot"])],
      { reason: "too_few_options", line: 0, groupId: "g-size" },
    ],
    [
      "two options in a pick-one group",
      [line(kopiSusu, 1, ["o-regular", "o-large"])],
      { reason: "too_many_options", line: 0, groupId: "g-size" },
    ],
    [
      "three options in a pick-up-to-two group",
      [line(kopiSusu, 1, ["o-regular", "o-shot", "o-oat", "o-less-sugar"])],
      { reason: "too_many_options", line: 0, groupId: "g-extras" },
    ],
    [
      "a unit price below zero after deltas",
      [line(misconfigured, 1, ["o-promo"])],
      { reason: "negative_price", line: 0 },
    ],
  ] as const)("%s", (_case, lines, details) => {
    const error = rejection([...lines]);
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.details).toEqual(details);
  });
});

describe("selectionProblems (C-02 blocks Add until this is empty)", () => {
  it("is empty for a valid selection", () => {
    expect(selectionProblems(kopiSusu, ["o-large", "o-shot"])).toEqual([]);
    expect(selectionProblems(croissant, [])).toEqual([]);
  });

  it("lists every group that needs attention", () => {
    expect(
      selectionProblems(kopiSusu, ["o-shot", "o-oat", "o-less-sugar"]),
    ).toEqual([
      { groupId: "g-size", reason: "too_few_options" },
      { groupId: "g-extras", reason: "too_many_options" },
    ]);
  });

  it("reports options that are not on the item", () => {
    expect(selectionProblems(croissant, ["o-large"])).toEqual([
      { optionId: "o-large", reason: "unknown_option" },
    ]);
  });
});

describe("previewLineTotal (C-02 live price)", () => {
  it("equals priceOrder's line total for a valid selection", () => {
    const options = ["o-large", "o-shot", "o-oat"];
    const priced = priceOrder([line(kopiSusu, 3, options)], catalog, noTax);
    expect(previewLineTotal(kopiSusu, options, 3)).toBe(
      priced.lines[0]!.lineTotal,
    );
  });

  it("prices an incomplete selection from what is chosen so far", () => {
    expect(previewLineTotal(kopiSusu, ["o-shot"], 2)).toBe(54_000);
    expect(previewLineTotal(esTeh, [], 1)).toBe(15_000);
  });
});
