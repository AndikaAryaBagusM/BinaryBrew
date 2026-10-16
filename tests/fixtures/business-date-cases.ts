// Shared by tests/unit/time.test.ts and tests/db/business-date.test.ts so the
// TypeScript and SQL implementations are checked against the same cases.
// Asia/Jakarta is UTC+7 all year (no daylight saving).
export const businessDateCases: [
  iso: string,
  cutoff: string,
  expected: string,
][] = [
  // Around midnight local time: the night belongs to the day that started.
  ["2026-10-16T16:59:59Z", "04:00", "2026-10-16"], // 23:59:59 on the 16th
  ["2026-10-16T17:00:00Z", "04:00", "2026-10-16"], // 00:00:00 on the 17th
  ["2026-10-16T17:00:01Z", "04:00", "2026-10-16"],
  // Around the 04:00 cutoff.
  ["2026-10-16T20:59:59Z", "04:00", "2026-10-16"], // 03:59:59 on the 17th
  ["2026-10-16T21:00:00Z", "04:00", "2026-10-17"], // 04:00:00 on the 17th
  ["2026-10-16T21:00:01Z", "04:00", "2026-10-17"],
  // Month and year boundaries.
  ["2026-10-31T20:30:00Z", "04:00", "2026-10-31"], // 03:30 on 1 Nov
  ["2026-12-31T20:59:59Z", "04:00", "2026-12-31"], // 03:59:59 on 1 Jan
  ["2026-12-31T21:00:00Z", "04:00", "2027-01-01"], // 04:00 on 1 Jan
  ["2028-02-29T19:00:00Z", "04:00", "2028-02-29"], // 02:00 on 1 Mar (leap year)
  // Other cutoffs.
  ["2026-10-16T17:00:00Z", "00:00", "2026-10-17"], // midnight cutoff = local date
  ["2026-10-16T16:59:59Z", "00:00", "2026-10-16"],
  ["2026-10-16T19:29:59Z", "02:30", "2026-10-16"], // 02:29:59 on the 17th
  ["2026-10-16T19:30:00Z", "02:30", "2026-10-17"], // 02:30:00 on the 17th
];
