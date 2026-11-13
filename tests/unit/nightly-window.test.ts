import { describe, expect, it } from "vitest";
import { nightlyWindow } from "@/modules/recommendations/service";

// The worker runs the Apriori job between 03:00 and 04:00 Asia/Jakarta
// (Tech §10). 03:00 in Jakarta is 20:00 UTC the day before.
describe("nightlyWindow", () => {
  const opens = new Date("2026-11-01T20:00:00Z");

  it.each([
    ["2026-11-01T20:00:00Z"],
    ["2026-11-01T20:30:00Z"],
    ["2026-11-01T20:59:59Z"],
  ])("is open at %s", (iso) => {
    expect(nightlyWindow(new Date(iso))).toEqual(opens);
  });

  it.each([
    ["2026-11-01T19:59:59Z"], // 02:59:59
    ["2026-11-01T21:00:00Z"], // 04:00
    ["2026-11-02T05:00:00Z"], // noon
  ])("is closed at %s", (iso) => {
    expect(nightlyWindow(new Date(iso))).toBeNull();
  });
});
