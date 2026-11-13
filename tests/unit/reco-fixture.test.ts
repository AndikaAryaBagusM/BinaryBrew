import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSeedOrders } from "@/modules/orders/seed-generator";
import { defaultSettings } from "@/modules/settings/definitions";

// The Python job's tests use copies of TypeScript data (P1-15). These tests
// keep the copies equal. To rewrite the basket fixture after changing the
// generator: UPDATE_RECO_FIXTURE=1 npx vitest run tests/unit/reco-fixture.test.ts

const FIXTURE = "jobs/apriori/tests/fixtures/seed_baskets.json";

// One basket per line: the distinct item names, sorted.
function basketsJson(): string {
  const baskets = generateSeedOrders({ endDate: "2026-10-31" }).map((order) =>
    [...new Set(order.lines.map((line) => line.name))].sort(),
  );
  return `[\n${baskets.map((b) => JSON.stringify(b)).join(",\n")}\n]\n`;
}

describe("Apriori job fixtures", () => {
  it("seed_baskets.json matches the seed generator", () => {
    const expected = basketsJson();
    if (process.env.UPDATE_RECO_FIXTURE === "1" || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, expected);
    }
    expect(readFileSync(FIXTURE, "utf8").replace(/\r\n/g, "\n")).toBe(expected);
  });

  it("db.py uses the same reco_* setting defaults", () => {
    const source = readFileSync("jobs/apriori/db.py", "utf8");
    for (const key of [
      "reco_min_support",
      "reco_min_confidence",
      "reco_min_lift",
      "reco_min_orders",
    ] as const) {
      expect(source).toContain(`"${key}": ${defaultSettings[key]},`);
    }
  });
});
