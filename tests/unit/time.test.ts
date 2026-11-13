import { describe, expect, it } from "vitest";
import {
  addDays,
  businessDate,
  formatDate,
  formatLastActive,
  formatTime,
  parseCutoff,
  parseShopLocalTime,
} from "@/lib/time";
import { businessDateCases } from "../fixtures/business-date-cases";

describe("businessDate (BR-14)", () => {
  it.each(businessDateCases)(
    "%s with cutoff %s → %s",
    (iso, cutoff, expected) => {
      expect(businessDate(new Date(iso), cutoff)).toBe(expected);
    },
  );

  it("defaults to the 04:00 cutoff", () => {
    expect(businessDate(new Date("2026-10-16T20:59:59Z"))).toBe("2026-10-16");
    expect(businessDate(new Date("2026-10-16T21:00:00Z"))).toBe("2026-10-17");
  });

  it("rejects an invalid date", () => {
    expect(() => businessDate(new Date("nope"))).toThrow(RangeError);
  });
});

describe("parseCutoff", () => {
  it.each([
    ["00:00", 0],
    ["04:00", 240],
    ["02:30", 150],
    ["23:59", 1_439],
  ])("%s → %i minutes", (value, minutes) => {
    expect(parseCutoff(value)).toBe(minutes);
  });

  it.each(["4:00", "24:00", "04:60", "0400", "", "04:00:00"])(
    "rejects %j",
    (value) => {
      expect(() => parseCutoff(value)).toThrow(RangeError);
    },
  );
});

describe("display formats (Design §9)", () => {
  it("formats time as 24-hour Asia/Jakarta with a dot", () => {
    expect(formatTime(new Date("2026-10-08T11:30:00Z"))).toBe("18.30");
    expect(formatTime(new Date("2026-10-08T17:05:00Z"))).toBe("00.05");
  });

  it("formats dates as day, short Indonesian month, year", () => {
    expect(formatDate(new Date("2026-10-08T05:00:00Z"))).toBe("8 Okt 2026");
    expect(formatDate(new Date("2026-10-08T17:30:00Z"))).toBe("9 Okt 2026");
  });
});

describe("formatLastActive (O-13)", () => {
  // 1 Nov 2026 10.00 in Jakarta (UTC+7).
  const now = new Date("2026-11-01T03:00:00Z");

  it("shows the time for today, in shop time", () => {
    expect(
      formatLastActive(new Date("2026-10-31T17:05:00Z"), now, "kemarin"),
    ).toBe("00.05");
  });

  it("says yesterday for the day before", () => {
    expect(
      formatLastActive(new Date("2026-10-31T16:59:00Z"), now, "kemarin"),
    ).toBe("kemarin");
  });

  it("shows the date for older days", () => {
    expect(
      formatLastActive(new Date("2026-10-29T05:00:00Z"), now, "kemarin"),
    ).toBe(formatDate(new Date("2026-10-29T05:00:00Z")));
  });
});

describe("addDays", () => {
  it("moves across months and years", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2027-01-01", -60)).toBe("2026-11-02");
  });

  it("refuses a malformed date", () => {
    expect(() => addDays("2026-10-1", 1)).toThrow(RangeError);
  });
});

describe("parseShopLocalTime", () => {
  it("reads shop local time (UTC+7)", () => {
    expect(parseShopLocalTime("2026-10-01 09:15")).toEqual(
      new Date("2026-10-01T02:15:00Z"),
    );
    expect(parseShopLocalTime("2026-10-01T00:30:45")).toEqual(
      new Date("2026-09-30T17:30:45Z"),
    );
  });

  it.each([
    "2026-02-30 09:00",
    "2026-10-01 24:00",
    "2026-10-01",
    "1/10/2026 09:00",
    "2026-10-01 09:00Z",
  ])("refuses %s", (text) => {
    expect(parseShopLocalTime(text)).toBeNull();
  });
});
