import { describe, expect, it } from "vitest";
import { businessDate, formatDate, formatTime, parseCutoff } from "@/lib/time";
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
