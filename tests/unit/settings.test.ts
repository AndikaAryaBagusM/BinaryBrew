import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  defaultSettings,
  isSettingKey,
  settingDefinitions,
  settingKeys,
} from "@/modules/settings/definitions";

// The defaults are written in two places: the docs/05 §3.9 SQL and the
// settings module. This keeps them equal.
function docDefaults(): Record<string, unknown> {
  const doc = readFileSync("docs/05-backend-schema.md", "utf8");
  const section = doc.slice(doc.indexOf("### 3.9 Default settings"));
  const block = section.slice(0, section.indexOf("on conflict"));
  return Object.fromEntries(
    [...block.matchAll(/\('(\w+)',\s+'(.+?)'\)/g)].map((m) => [
      m[1]!,
      JSON.parse(m[2]!),
    ]),
  );
}

describe("setting definitions", () => {
  it("match the Schema §3.9 defaults exactly", () => {
    const fromDoc = docDefaults();
    expect(Object.keys(fromDoc)).toHaveLength(20);
    expect(defaultSettings).toEqual(fromDoc);
  });

  it("accept their own defaults", () => {
    for (const key of settingKeys) {
      const { schema, default: value } = settingDefinitions[key];
      expect(schema.safeParse(value).success, key).toBe(true);
    }
  });

  it.each([
    ["tax_rate_bps", 1100, true],
    ["tax_rate_bps", -1, false],
    ["tax_rate_bps", 10.5, false],
    ["tax_rate_bps", "1100", false],
    ["service_charge_bps", 10_001, false],
    ["business_day_cutoff", "05:30", true],
    ["business_day_cutoff", "25:00", false],
    ["business_day_cutoff", "4", false],
    ["order_expiry_minutes", 0, false],
    ["ordering_enabled", "true", false],
    ["timezone", "Asia/Makassar", false],
    ["reco_min_confidence", 1.2, false],
    ["shop_name", "   ", false],
  ] as const)("%s = %j is valid: %s", (key, value, valid) => {
    expect(settingDefinitions[key].schema.safeParse(value).success).toBe(valid);
  });

  it("recognises only known keys", () => {
    expect(isSettingKey("tax_rate_bps")).toBe(true);
    expect(isSettingKey("toString")).toBe(false);
    expect(isSettingKey("unknown_key")).toBe(false);
  });
});
