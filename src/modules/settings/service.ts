import { getDb } from "@/db/client";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { audit } from "@/modules/audit/service";
import { requireRole, type SessionUser } from "@/modules/auth/service";
import {
  defaultSettings,
  isSettingKey,
  type SettingKey,
  type Settings,
  type SettingValue,
  settingDefinitions,
  settingKeys,
} from "./definitions";
import * as repo from "./repo";

// Typed settings (FR-OW-04, Schema §3.7). Values are read from the database on
// every call: no cache, because tax and service charge feed prices (CLAUDE.md).

function parseStored<K extends SettingKey>(
  key: K,
  value: unknown,
): SettingValue<K> {
  const result = settingDefinitions[key].schema.safeParse(value);
  if (!result.success) {
    // A bad stored value must stop pricing, not silently fall back.
    logger.error({ event: "settings.invalid_value", key });
    throw new AppError("INTERNAL", { details: { setting: key } });
  }
  return result.data as SettingValue<K>;
}

export async function getSettings<K extends SettingKey>(
  keys: readonly K[],
): Promise<Pick<Settings, K>> {
  const rows = await repo.selectSettings([...keys]);
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  // Each value is checked by its key's schema; TypeScript cannot follow that
  // per-key link through the generic, hence one cast at the end.
  const result: Partial<Record<SettingKey, unknown>> = {};
  for (const key of keys) {
    result[key] = stored.has(key)
      ? parseStored(key, stored.get(key))
      : defaultSettings[key];
  }
  return result as Pick<Settings, K>;
}

export async function getSetting<K extends SettingKey>(
  key: K,
): Promise<SettingValue<K>> {
  const values = await getSettings([key]);
  return values[key];
}

export function getAllSettings(): Promise<Settings> {
  return getSettings(settingKeys);
}

// Owner only. Validates the value, saves it and writes a setting.update audit
// row with the old and new value, in one transaction.
export async function setSetting(
  actor: SessionUser | null,
  key: string,
  value: unknown,
  { reason, now = new Date() }: { reason?: string; now?: Date } = {},
) {
  const owner = requireRole(actor, ["owner"]);
  if (!isSettingKey(key)) {
    throw new AppError("VALIDATION_FAILED", { details: { fields: ["key"] } });
  }
  const parsed = settingDefinitions[key].schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", { details: { fields: [key] } });
  }
  const next = parsed.data;

  return getDb().transaction(async (tx) => {
    const current = await repo.selectSettingForUpdate(key, tx);
    const previous = current ? current.value : defaultSettings[key];
    if (JSON.stringify(previous) === JSON.stringify(next)) {
      return { key, value: next, changed: false };
    }

    await repo.upsertSetting(
      { key, value: next, updatedBy: owner.userId, now },
      tx,
    );
    await audit(
      {
        action: "setting.update",
        actor: owner,
        entity: { type: "setting", id: key },
        reason,
        metadata: { from: previous, to: next },
      },
      { db: tx },
    );
    return { key, value: next, changed: true };
  });
}
