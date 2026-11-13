import { max } from "drizzle-orm";
import { type DbExecutor, getDb } from "@/db/client";
import { associationRuleRuns } from "@/db/schema";

// SQL only; rules live in service.ts.

export async function selectLatestRunStart(
  db: DbExecutor = getDb(),
): Promise<Date | null> {
  const [row] = await db
    .select({ startedAt: max(associationRuleRuns.startedAt) })
    .from(associationRuleRuns);
  return row?.startedAt ?? null;
}
