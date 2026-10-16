// Times are stored in UTC and shown in the shop's time zone (Tech §5).

export const SHOP_TIME_ZONE = "Asia/Jakarta";
export const DEFAULT_CUTOFF = "04:00";

// "HH:MM" (the business_day_cutoff setting) → minutes after midnight.
export function parseCutoff(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    throw new RangeError(
      `cutoff must be "HH:MM", got ${JSON.stringify(value)}`,
    );
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

const shopDateParts = new Intl.DateTimeFormat("en-US", {
  timeZone: SHOP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Business day as "YYYY-MM-DD" (BR-14): shop local time minus the cutoff.
// Mirrors SQL business_date_of(); tests/db/business-date.test.ts keeps them
// equal. Subtracting the cutoff before converting is the same as after it
// because Asia/Jakarta has no daylight saving.
export function businessDate(
  at: Date,
  cutoff: string = DEFAULT_CUTOFF,
): string {
  if (Number.isNaN(at.getTime())) throw new RangeError("Invalid date");
  const shifted = new Date(at.getTime() - parseCutoff(cutoff) * 60_000);
  const parts = Object.fromEntries(
    shopDateParts.formatToParts(shifted).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const timeFormat = new Intl.DateTimeFormat("id-ID", {
  timeZone: SHOP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dateFormat = new Intl.DateTimeFormat("id-ID", {
  timeZone: SHOP_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

// "18.30" (Design §9)
export function formatTime(at: Date): string {
  return timeFormat.format(at);
}

// "8 Okt 2026" (Design §9)
export function formatDate(at: Date): string {
  return dateFormat.format(at);
}
