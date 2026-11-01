import { type DbExecutor, getDb } from "@/db/client";
import { auditLogs } from "@/db/schema";

// SQL only. audit_logs is append-only: there is no update or delete here, and
// a database trigger refuses them (Schema §3.8, BR-10).
export async function insertAuditLog(
  values: typeof auditLogs.$inferInsert,
  db: DbExecutor = getDb(),
) {
  const [row] = await db
    .insert(auditLogs)
    .values(values)
    .returning({ id: auditLogs.id, createdAt: auditLogs.createdAt });
  return row!;
}
