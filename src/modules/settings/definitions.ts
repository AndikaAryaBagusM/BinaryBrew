import { z } from "zod";
import { parseCutoff } from "@/lib/time";

// Every setting the app reads: its type, allowed range and default (Schema §3.9).
// The seed writes these defaults; getSetting falls back to them when a row is
// missing. Rates are basis points (Schema §1).
const bps = z.int().min(0).max(10_000);
const ratio = z.number().min(0).max(1);
const weight = z.number().min(0).max(10);

const cutoff = z.string().refine(
  (value) => {
    try {
      parseCutoff(value);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'must be a time "HH:MM"' },
);

export const settingDefinitions = {
  shop_name: {
    schema: z.string().trim().min(1).max(60),
    default: "Binary Brew",
  },
  timezone: { schema: z.literal("Asia/Jakarta"), default: "Asia/Jakarta" },
  business_day_cutoff: { schema: cutoff, default: "04:00" },
  ordering_enabled: { schema: z.boolean(), default: true },
  tax_rate_bps: { schema: bps, default: 0 },
  tax_inclusive: { schema: z.boolean(), default: true },
  service_charge_bps: { schema: bps, default: 0 },
  order_expiry_minutes: { schema: z.int().min(1).max(60), default: 10 },
  ready_auto_complete_minutes: { schema: z.int().min(1).max(240), default: 30 },
  cash_enabled: { schema: z.boolean(), default: false },
  manual_payment_requires_owner_pin: { schema: z.boolean(), default: true },
  reco_min_support: { schema: ratio, default: 0.02 },
  reco_min_confidence: { schema: ratio, default: 0.25 },
  reco_min_lift: { schema: z.number().min(0).max(100), default: 1.05 },
  reco_min_orders: { schema: z.int().min(0), default: 300 },
  reco_promote_weight: { schema: weight, default: 0.5 },
  reco_margin_weight: { schema: weight, default: 0.25 },
  reco_max_items: { schema: z.int().min(1).max(5), default: 2 },
  low_margin_threshold_pct: { schema: z.number().min(0).max(100), default: 30 },
  order_retention_months: { schema: z.int().min(1).max(120), default: 24 },
} as const;

export type SettingKey = keyof typeof settingDefinitions;
export type SettingValue<K extends SettingKey> = z.infer<
  (typeof settingDefinitions)[K]["schema"]
>;
export type Settings = { [K in SettingKey]: SettingValue<K> };

export const settingKeys = Object.keys(settingDefinitions) as SettingKey[];

export const defaultSettings = Object.fromEntries(
  settingKeys.map((key) => [key, settingDefinitions[key].default]),
) as Settings;

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(settingDefinitions, key);
}
