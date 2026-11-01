import { eq, inArray } from "drizzle-orm";
import { type DbExecutor, getDb } from "@/db/client";
import { settings } from "@/db/schema";

// SQL only; types and rules live in service.ts.

export function selectSettings(keys: string[], db: DbExecutor = getDb()) {
  return db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, keys));
}

// Row lock so two owners saving the same setting record a correct "from".
export async function selectSettingForUpdate(
  key: string,
  db: DbExecutor = getDb(),
) {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .for("update");
  return row;
}

export async function upsertSetting(
  values: { key: string; value: unknown; updatedBy: string; now: Date },
  db: DbExecutor = getDb(),
) {
  await db
    .insert(settings)
    .values({
      key: values.key,
      value: values.value,
      updatedBy: values.updatedBy,
      updatedAt: values.now,
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: {
        value: values.value,
        updatedBy: values.updatedBy,
        updatedAt: values.now,
      },
    });
}
