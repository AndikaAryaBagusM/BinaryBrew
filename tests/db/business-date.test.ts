import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { businessDate } from "@/lib/time";
import { businessDateCases } from "../fixtures/business-date-cases";

const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });
afterAll(() => sql.end());

// Tech §5: businessDate() mirrors the SQL function business_date_of; this keeps them equal.
describe("businessDate matches SQL business_date_of", () => {
  it.each(businessDateCases)(
    "%s with cutoff %s",
    async (iso, cutoff, expected) => {
      const [row] = await sql`
        select business_date_of(${iso}::timestamptz, ${cutoff}::interval)::text as day`;
      expect(row!.day).toBe(expected);
      expect(businessDate(new Date(iso), cutoff)).toBe(row!.day);
    },
  );

  it("uses the same 04:00 default", async () => {
    const iso = "2026-10-16T20:59:59Z";
    const [row] =
      await sql`select business_date_of(${iso}::timestamptz)::text as day`;
    expect(businessDate(new Date(iso))).toBe(row!.day);
  });
});
