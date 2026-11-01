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
