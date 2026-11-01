import { z } from "zod";
import { type SettingKey, settingDefinitions } from "./definitions";

// O-14 basic (FR-OW-04, Phase 1): the settings the owner can change today.
// Not here: timezone (fixed), cash_enabled (no cash in v1, D11), the
// recommendation weights and thresholds (O-14 full, P3-05).
export const ownerSettingKeys = [
  "shop_name",
  "business_day_cutoff",
  "ordering_enabled",
  "tax_rate_bps",
  "tax_inclusive",
  "service_charge_bps",
  "order_expiry_minutes",
  "manual_payment_requires_owner_pin",
  "ready_auto_complete_minutes",
  "order_retention_months",
  "low_margin_threshold_pct",
] as const satisfies readonly SettingKey[];
export type OwnerSettingKey = (typeof ownerSettingKeys)[number];

type OwnerSettingsShape = {
  [K in OwnerSettingKey]: z.ZodOptional<
    (typeof settingDefinitions)[K]["schema"]
  >;
};

// Any subset of those keys; unknown keys are refused.
export const ownerSettingsBody = z.strictObject(
  Object.fromEntries(
    ownerSettingKeys.map((key) => [
      key,
      settingDefinitions[key].schema.optional(),
    ]),
  ) as OwnerSettingsShape,
);
