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

// O-13 "Terakhir aktif": "18.41" today, "kemarin" yesterday, otherwise the
// date; calendar days in the shop's time zone.
export function formatLastActive(
  at: Date,
  now: Date,
  yesterdayLabel: string,
): string {
  const day = formatDate(at);
  if (day === formatDate(now)) return formatTime(at);
  if (day === formatDate(new Date(now.getTime() - 86_400_000))) {
    return yesterdayLabel;
  }
  return day;
}

// "2026-10-31" + 1 → "2026-11-01" (calendar days; business dates have no
// time zone).
export function addDays(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError(`date must be YYYY-MM-DD, got ${date}`);
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const SHOP_UTC_OFFSET_MINUTES = 7 * 60; // Asia/Jakarta, no daylight saving

// "2026-10-31 18:30" or "2026-10-31T18:30:15" read as shop local time; null
// if it is not that shape or not a real date and time.
export function parseShopLocalTime(text: string): Date | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match) return null;
  const [y, mo, d, h, mi, s] = match
    .slice(1)
    .map((part) => Number(part ?? 0)) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const local = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const real =
    local.getUTCFullYear() === y &&
    local.getUTCMonth() === mo - 1 &&
    local.getUTCDate() === d &&
    local.getUTCHours() === h &&
    local.getUTCMinutes() === mi &&
    local.getUTCSeconds() === s;
  if (!real) return null;
  return new Date(local.getTime() - SHOP_UTC_OFFSET_MINUTES * 60_000);
}
