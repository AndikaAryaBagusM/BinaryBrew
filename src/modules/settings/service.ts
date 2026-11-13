import { type DbExecutor, getDb } from "@/db/client";
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
  db: DbExecutor = getDb(),
): Promise<Pick<Settings, K>> {
  const rows = await repo.selectSettings([...keys], db);
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
    const changed = await writeSetting(tx, owner, key, next, reason, now);
    return { key, value: next, changed };
  });
}

// O-14 "Simpan perubahan" (FR-OW-04): several settings at once, all or
// nothing. Every value is checked before anything is written; each key that
// really changes gets its own setting.update row. Rows are locked in key
// order, so two saves cannot deadlock.
export async function setSettings(
  actor: SessionUser | null,
  values: Partial<Settings>,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ changed: SettingKey[] }> {
  const owner = requireRole(actor, ["owner"]);
  const entries: [SettingKey, unknown][] = [];
  const invalid: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (!isSettingKey(key)) {
      invalid.push(key);
      continue;
    }
    const parsed = settingDefinitions[key].schema.safeParse(value);
    if (parsed.success) entries.push([key, parsed.data]);
    else invalid.push(key);
  }
  if (invalid.length > 0) {
    throw new AppError("VALIDATION_FAILED", { details: { fields: invalid } });
  }
  entries.sort(([a], [b]) => a.localeCompare(b));

  return getDb().transaction(async (tx) => {
    const changed: SettingKey[] = [];
    for (const [key, next] of entries) {
      if (await writeSetting(tx, owner, key, next, undefined, now)) {
        changed.push(key);
      }
    }
    return { changed };
  });
}

async function writeSetting(
  tx: DbExecutor,
  owner: SessionUser,
  key: SettingKey,
  next: unknown,
  reason: string | undefined,
  now: Date,
): Promise<boolean> {
  const current = await repo.selectSettingForUpdate(key, tx);
  const previous = current ? current.value : defaultSettings[key];
  if (JSON.stringify(previous) === JSON.stringify(next)) return false;
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
    { db: tx, now },
  );
  return true;
}
