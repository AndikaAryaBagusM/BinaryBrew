import { AppError } from "@/lib/errors";
import {
  exclusiveTaxAmount,
  inclusiveTaxAmount,
  serviceChargeAmount,
} from "@/lib/money";

// Order pricing (FR-TX-01, FR-CO-03, BR-03, Schema §5.1). Pure: the caller
// loads the catalog and settings, so the cart (P1-05) shows the same price the
// server charges. Clients send ids and quantities only, never prices.

export const MAX_QUANTITY = 20; // per line (BR-11)
export const MAX_LINES = 30; // per order (BR-11)

export type PricingOption = { id: string; name: string; priceDelta: number };

export type PricingGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: PricingOption[];
};

// Active catalog data; PublicMenuItem from the menu service fits this shape.
export type PricingItem = {
  id: string;
  name: string;
  price: number;
  modifierGroups: PricingGroup[];
};

export type CartLine = {
  menuItemId: string;
  quantity: number;
  modifierOptionIds: readonly string[];
};

export type PricingRates = {
  taxRateBps: number;
  taxInclusive: boolean;
  serviceChargeBps: number;
};

export type PricedModifier = {
  optionId: string;
  groupName: string;
  optionName: string;
  priceDelta: number;
};

export type PricedLine = {
  menuItemId: string;
  name: string;
  unitPrice: number;
  modifiersTotal: number; // per unit
  quantity: number;
  lineTotal: number;
  modifiers: PricedModifier[];
};

// Field names match the orders columns.
export type PricedOrder = {
  lines: PricedLine[];
  subtotal: number;
  serviceChargeBps: number;
  serviceCharge: number;
  taxRateBps: number;
  taxInclusive: boolean;
  taxAmount: number;
  total: number;
};

export type SelectionProblem =
  | { groupId: string; reason: "too_few_options" | "too_many_options" }
  | { optionId: string; reason: "unknown_option" | "duplicate_option" };

// Every reason a set of chosen options is not valid for the item, in order:
// unknown or repeated options first, then groups in catalog order.
export function selectionProblems(
  item: PricingItem,
  optionIds: readonly string[],
): SelectionProblem[] {
  const problems: SelectionProblem[] = [];
  const known = new Set(
    item.modifierGroups.flatMap((group) => group.options.map((o) => o.id)),
  );
  const seen = new Set<string>();
  for (const optionId of optionIds) {
    if (!known.has(optionId)) {
      problems.push({ optionId, reason: "unknown_option" });
    } else if (seen.has(optionId)) {
      problems.push({ optionId, reason: "duplicate_option" });
    }
    seen.add(optionId);
  }
  for (const group of item.modifierGroups) {
    const count = group.options.filter((o) => seen.has(o.id)).length;
    if (count < group.minSelect) {
      problems.push({ groupId: group.id, reason: "too_few_options" });
    } else if (count > group.maxSelect) {
      problems.push({ groupId: group.id, reason: "too_many_options" });
    }
  }
  return problems;
}

function refuse(details: Record<string, unknown>): never {
  throw new AppError("VALIDATION_FAILED", { details });
}

function priceLine(item: PricingItem, cartLine: CartLine, index: number) {
  const [problem] = selectionProblems(item, cartLine.modifierOptionIds);
  if (problem) refuse({ ...problem, line: index });

  const chosen = new Set(cartLine.modifierOptionIds);
  // Catalog order, so snapshots do not depend on the client's order.
  const modifiers: PricedModifier[] = item.modifierGroups.flatMap((group) =>
    group.options
      .filter((option) => chosen.has(option.id))
      .map((option) => ({
        optionId: option.id,
        groupName: group.name,
        optionName: option.name,
        priceDelta: option.priceDelta,
      })),
  );
  const modifiersTotal = modifiers.reduce((sum, m) => sum + m.priceDelta, 0);
  if (item.price + modifiersTotal < 0) {
    refuse({ reason: "negative_price", line: index });
  }
  return {
    menuItemId: item.id,
    name: item.name,
    unitPrice: item.price,
    modifiersTotal,
    quantity: cartLine.quantity,
    lineTotal: (item.price + modifiersTotal) * cartLine.quantity,
    modifiers,
  };
}

// Prices a whole order. Refuses with VALIDATION_FAILED and details.reason
// (plus the line index and group or option where it applies).
export function priceOrder(
  lines: readonly CartLine[],
  items: readonly PricingItem[],
  rates: PricingRates,
): PricedOrder {
  if (lines.length === 0) refuse({ reason: "empty_order" });
  if (lines.length > MAX_LINES) refuse({ reason: "too_many_lines" });

  const itemsById = new Map(items.map((item) => [item.id, item]));
  const priced = lines.map((cartLine, index) => {
    const { quantity } = cartLine;
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY
    ) {
      refuse({ reason: "invalid_quantity", line: index });
    }
    const item = itemsById.get(cartLine.menuItemId);
    if (!item) refuse({ reason: "unknown_item", line: index });
    return priceLine(item, cartLine, index);
  });

  const subtotal = priced.reduce((sum, line) => sum + line.lineTotal, 0);
  const serviceCharge = serviceChargeAmount(subtotal, rates.serviceChargeBps);
  const base = subtotal + serviceCharge;
  const taxAmount = rates.taxInclusive
    ? inclusiveTaxAmount(base, rates.taxRateBps)
    : exclusiveTaxAmount(base, rates.taxRateBps);

  return {
    lines: priced,
    subtotal,
    serviceChargeBps: rates.serviceChargeBps,
    serviceCharge,
    taxRateBps: rates.taxRateBps,
    taxInclusive: rates.taxInclusive,
    taxAmount,
    total: rates.taxInclusive ? base : base + taxAmount,
  };
}
