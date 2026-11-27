// The only place that does tax and rounding arithmetic (Tech §4 rule 3).
// Money is whole rupiah held in safe integers; rates are basis points
// (1100 = 11 %). Rounding is half-up on non-negative values (Tech §5).

const BPS_PER_UNIT = 10_000;

function assertAmount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `${name} must be a non-negative safe integer, got ${value}`,
    );
  }
}

// numerator / denominator rounded half-up, using integer arithmetic only.
export function divideRoundHalfUp(
  numerator: number,
  denominator: number,
): number {
  assertAmount(numerator, "numerator");
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError(
      `denominator must be a positive safe integer, got ${denominator}`,
    );
  }
  let quotient = Math.floor(numerator / denominator);
  let remainder = numerator - quotient * denominator;
  // Correct a float division that landed on the wrong side of an integer.
  if (remainder < 0) {
    quotient -= 1;
    remainder += denominator;
  } else if (remainder >= denominator) {
    quotient += 1;
    remainder -= denominator;
  }
  return remainder * 2 >= denominator ? quotient + 1 : quotient;
}

// service_charge = round(subtotal × service_charge_bps / 10000) (Schema §5.1)
export function serviceChargeAmount(subtotal: number, bps: number): number {
  assertAmount(subtotal, "subtotal");
  assertAmount(bps, "service charge bps");
  return divideRoundHalfUp(subtotal * bps, BPS_PER_UNIT);
}

// Tax already included in a tax-inclusive total (Schema §5.1):
// tax_amount = round(total × tax_rate_bps / (10000 + tax_rate_bps))
export function inclusiveTaxAmount(total: number, bps: number): number {
  assertAmount(total, "total");
  assertAmount(bps, "tax rate bps");
  return divideRoundHalfUp(total * bps, BPS_PER_UNIT + bps);
}

// Tax added on top when tax_inclusive is false (Schema §5.1):
// tax_amount = round((subtotal + service_charge) × tax_rate_bps / 10000)
export function exclusiveTaxAmount(base: number, bps: number): number {
  assertAmount(base, "tax base");
  assertAmount(bps, "tax rate bps");
  return divideRoundHalfUp(base * bps, BPS_PER_UNIT);
}

const rupiahDigits = new Intl.NumberFormat("id-ID", {
  maximumFractionDigits: 0,
});

// "Rp 22.000" (Design §9), with a non-breaking space so it never wraps.
export function formatRupiah(amount: number): string {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`amount must be a safe integer, got ${amount}`);
  }
  const sign = amount < 0 ? "-" : "";
  return `${sign}Rp ${rupiahDigits.format(Math.abs(amount))}`;
}

// Option price change in C-02: "+Rp 5.000", "−Rp 2.000" (a true minus sign),
// and nothing for a free option.
export function formatPriceDelta(delta: number): string {
  if (delta === 0) return "";
  const amount = formatRupiah(Math.abs(delta));
  return delta > 0 ? `+${amount}` : `−${amount}`;
}

// O-03 price field: "22.000", "Rp 22.000" or "22000" → 22000; null if it is
// not a whole number of rupiah.
export function parseRupiahInput(text: string): number | null {
  const digits = text.replace(/^\s*rp\s*/i, "").replace(/[.\s]/g, "");
  return /^\d{1,9}$/.test(digits) ? Number(digits) : null;
}

// O-04 option price change: "5.000", "-2.000" or "−2.000" (true minus) →
// 5000 or -2000; null if it is not a whole number of rupiah.
export function parsePriceDeltaInput(text: string): number | null {
  const match = /^\s*([-−]?)\s*(.*)$/.exec(text)!;
  const amount = parseRupiahInput(match[2]!);
  if (amount === null) return null;
  return match[1] && amount !== 0 ? -amount : amount;
}

// O-14 rate fields, in percent with up to two decimals ("11", "11,5" or
// "11.25") ↔ basis points; null outside 0–100 %.
export function percentToBps(text: string): number | null {
  const match = /^\s*(\d{1,3})(?:[.,](\d{1,2}))?\s*%?\s*$/.exec(text);
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bps <= BPS_PER_UNIT ? bps : null;
}

// 1100 → "11", 1150 → "11,5", 1125 → "11,25".
export function formatBpsAsPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const cents = bps % 100;
  if (cents === 0) return String(whole);
  return `${whole},${String(cents).padStart(2, "0").replace(/0$/, "")}`;
}

// Ingredient cost per base unit (Schema §3.5 `avg_cost`, numeric(14,4)) is
// carried as a decimal string ("285.0000") and handled here in whole
// ten-thousandths of a rupiah.
const COST_SCALE = BigInt(10_000);
const big = (value: number) => BigInt(value);
const COST_DECIMAL = /^(\d{1,10})(?:\.(\d{1,4}))?$/;

// Opening stock (docs/05 §3.5): the cost per unit of a quantity bought for
// `totalCost` rupiah, rounded half-up to 4 decimals. `quantityMilli` is in
// thousandths of a unit (lib/quantity.ts). BigInt, so large totals stay exact.
export function unitCostFromTotal(
  totalCost: number,
  quantityMilli: number,
): string {
  assertAmount(totalCost, "total cost");
  if (!Number.isSafeInteger(quantityMilli) || quantityMilli <= 0) {
    throw new RangeError(
      `quantity must be a positive safe integer, got ${quantityMilli}`,
    );
  }
  return costText(
    BigInt(totalCost) * big(1000) * COST_SCALE,
    BigInt(quantityMilli),
  );
}

// numerator / denominator (both non-negative) rounded half-up, as an
// avg_cost string with 4 decimals.
function costText(numerator: bigint, denominator: bigint): string {
  let scaled = numerator / denominator;
  if ((numerator % denominator) * big(2) >= denominator) scaled += big(1);
  const whole = scaled / COST_SCALE;
  const fraction = String(scaled % COST_SCALE).padStart(4, "0");
  return `${whole}.${fraction}`;
}

// Restock (FR-IV-05, BR-09, Schema §5.5): the weighted average of the stock
// on hand at its current cost and the purchase at what was paid for it,
// rounded half-up to 4 decimals once. Stock at or below zero counts as none,
// so the purchase price becomes the average. The exact total is used, not the
// rounded unit price. Quantities are thousandths of a unit (lib/quantity.ts).
export function weightedAverageCost(
  current: { stockMilli: number; avgCost: string },
  purchase: { quantityMilli: number; totalCost: number },
): string {
  assertAmount(purchase.totalCost, "total cost");
  if (
    !Number.isSafeInteger(purchase.quantityMilli) ||
    purchase.quantityMilli <= 0
  ) {
    throw new RangeError(
      `quantity must be a positive safe integer, got ${purchase.quantityMilli}`,
    );
  }
  if (!Number.isSafeInteger(current.stockMilli)) {
    throw new RangeError(`stock must be a safe integer`);
  }
  const base = big(Math.max(current.stockMilli, 0));
  return costText(
    base * costScaled(current.avgCost) +
      BigInt(purchase.totalCost) * big(1000) * COST_SCALE,
    base + BigInt(purchase.quantityMilli),
  );
}

// -1, 0 or 1: how the new average compares with the old one (O-07 "naik
// dari", "turun dari", "tetap").
export function compareCost(a: string, b: string): -1 | 0 | 1 {
  const left = costScaled(a);
  const right = costScaled(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

// True when the cost is zero: O-05 shows "Biaya belum ada".
export function isZeroCost(cost: string): boolean {
  const match = COST_DECIMAL.exec(cost.trim());
  if (!match) throw new RangeError(`not a cost: "${cost}"`);
  return /^0+$/.test(match[1]!) && /^0*$/.test(match[2] ?? "");
}

const costDigits = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// O-05 "Biaya rata-rata": "285.0000" → "Rp 285,00", "11000" → "Rp 11.000,00"
// (half-up to 2 decimals for display only).
export function formatUnitCost(cost: string): string {
  const match = COST_DECIMAL.exec(cost.trim());
  if (!match) throw new RangeError(`not a cost: "${cost}"`);
  const scaled =
    BigInt(match[1]!) * COST_SCALE + BigInt((match[2] ?? "").padEnd(4, "0"));
  let cents = scaled / big(100);
  if (scaled % big(100) >= big(50)) cents += big(1);
  const whole = cents / big(100);
  const fraction = Number(cents % big(100)) / 100;
  const text = costDigits.format(Number(whole) + fraction);
  return `Rp ${text}`;
}

function costScaled(cost: string): bigint {
  const match = COST_DECIMAL.exec(cost.trim());
  if (!match) throw new RangeError(`not a cost: "${cost}"`);
  return (
    BigInt(match[1]!) * COST_SCALE + BigInt((match[2] ?? "").padEnd(4, "0"))
  );
}

// quantity (thousandths of a unit) × cost per unit (ten-thousandths of a
// rupiah), rounded half-up to whole rupiah. Exact: BigInt throughout.
const LINE_SCALE = BigInt(1000) * COST_SCALE;

function roundScaled(value: bigint): number {
  let rupiah = value / LINE_SCALE;
  if ((value % LINE_SCALE) * big(2) >= LINE_SCALE) rupiah += big(1);
  return Number(rupiah);
}

export type CostLine = { quantityMilli: number; avgCost: string };

function lineScaled({ quantityMilli, avgCost }: CostLine): bigint {
  if (!Number.isSafeInteger(quantityMilli) || quantityMilli < 0) {
    throw new RangeError(`quantity must be a non-negative safe integer`);
  }
  return BigInt(quantityMilli) * costScaled(avgCost);
}

// O-06 "Biaya" column: 18 g at Rp 285,0000 → 5130.
export function lineCost(line: CostLine): number {
  return roundScaled(lineScaled(line));
}

// O-06 HPP preview: the exact sum of quantity × average cost over the recipe,
// rounded half-up to whole rupiah once (so it can differ by a rupiah from the
// sum of the rounded line costs). Schema §3.8 v_menu_item_cost does the same
// sum in SQL.
export function recipeCost(lines: readonly CostLine[]): number {
  return roundScaled(
    lines.reduce((sum, line) => sum + lineScaled(line), big(0)),
  );
}

// O-06 margin: "Rp 11.836 · 53,8%". The percentage is of the selling price,
// half-up to one decimal (away from zero for a loss); null when the price is 0.
export function formatMargin(price: number, hpp: number): string {
  assertAmount(price, "price");
  assertAmount(hpp, "hpp");
  const margin = price - hpp;
  const amount =
    margin < 0 ? `−${formatRupiah(-margin)}` : formatRupiah(margin);
  if (price === 0) return amount;
  const permille = divideRoundHalfUp(Math.abs(margin) * 1000, price);
  const text = `${Math.floor(permille / 10)},${permille % 10}%`;
  return `${amount} · ${margin < 0 ? "−" : ""}${text}`;
}
