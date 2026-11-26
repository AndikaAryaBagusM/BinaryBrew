// Ingredient quantities (Schema §1: numeric(14,3) in the ingredient's base
// unit). The database and the API carry them as decimal strings ("3250.000");
// in code they are whole thousandths ("milli") so sums stay exact.

export const MILLI_PER_UNIT = 1000;
// numeric(14,3) holds 11 digits before the point.
export const MAX_QUANTITY_MILLI = 99_999_999_999_999;

const DECIMAL = /^(-?)(\d{1,11})(?:\.(\d{1,3}))?$/;

// "3250.000" or "-2" → 3250000 or -2000. Throws on anything else: these
// strings come from the database or a validated API body.
export function toMilli(decimal: string): number {
  const match = DECIMAL.exec(decimal.trim());
  if (!match) throw new RangeError(`not a quantity: "${decimal}"`);
  const milli =
    Number(match[2]) * MILLI_PER_UNIT + Number((match[3] ?? "").padEnd(3, "0"));
  return match[1] === "-" && milli !== 0 ? -milli : milli;
}

// 3250000 → "3250.000", the numeric(14,3) text form.
export function fromMilli(milli: number): string {
  if (!Number.isSafeInteger(milli) || Math.abs(milli) > MAX_QUANTITY_MILLI) {
    throw new RangeError(`quantity out of range: ${milli}`);
  }
  const sign = milli < 0 ? "-" : "";
  const abs = Math.abs(milli);
  const whole = Math.floor(abs / MILLI_PER_UNIT);
  const fraction = String(abs % MILLI_PER_UNIT).padStart(3, "0");
  return `${sign}${whole}.${fraction}`;
}

// API input: a non-negative decimal string with up to 3 decimals.
export const QUANTITY_PATTERN = /^\d{1,11}(?:\.\d{1,3})?$/;

const groupedDigits = new Intl.NumberFormat("id-ID", {
  maximumFractionDigits: 3,
});

// O-05: 3250000 → "3.250", 500 → "0,5", -2000 → "−2" (a true minus sign).
export function formatQuantity(milli: number): string {
  const text = groupedDigits.format(Math.abs(milli) / MILLI_PER_UNIT);
  return milli < 0 ? `−${text}` : text;
}

// Owner form fields, written the Indonesian way: "3.250" (dots group
// thousands), "0,5" or "1.250,75" (a comma before up to 3 decimals), or plain
// digits. Returns milli, or null when the text is not such a number. A dot
// that does not group exactly three digits is refused, so "1.5" is not
// silently read as 15.
export function parseQuantityInput(text: string): number | null {
  const match = /^\s*(\d{1,3}(?:\.\d{3})+|\d{1,11})(?:,(\d{1,3}))?\s*$/.exec(
    text,
  );
  if (!match) return null;
  const whole = match[1]!.replace(/\./g, "");
  if (whole.length > 11) return null;
  return (
    Number(whole) * MILLI_PER_UNIT + Number((match[2] ?? "").padEnd(3, "0"))
  );
}

// The field text for a stored quantity: 3250000 → "3.250", 500 → "0,5".
export function quantityInputText(milli: number): string {
  return formatQuantity(milli).replace("−", "-");
}

// O-04 ingredient delta field: like parseQuantityInput, with an optional
// leading "-" or "−" for an option that uses less ("-150" → -150000).
export function parseSignedQuantityInput(text: string): number | null {
  const match = /^\s*([-−]?)\s*(.*)$/.exec(text)!;
  const milli = parseQuantityInput(match[2]!);
  if (milli === null) return null;
  return match[1] && milli !== 0 ? -milli : milli;
}

// O-04 "Pengaruh ke stok": 9000 → "+9", -150000 → "−150".
export function formatQuantityDelta(milli: number): string {
  return milli > 0 ? `+${formatQuantity(milli)}` : formatQuantity(milli);
}
