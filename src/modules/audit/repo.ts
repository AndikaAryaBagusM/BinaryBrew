import { and, desc, eq, inArray } from "drizzle-orm";
import { type DbExecutor, getDb } from "@/db/client";
import { auditLogs, users } from "@/db/schema";

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

// The newest row per entity among the given actions, with the actor's name.
export async function selectLatestByEntity(
  entityType: string,
  entityIds: string[],
  actions: string[],
  db: DbExecutor = getDb(),
) {
  if (entityIds.length === 0) return [];
  return db
    .selectDistinctOn([auditLogs.entityId], {
      entityId: auditLogs.entityId,
      action: auditLogs.action,
      actorName: users.name,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(
      and(
        eq(auditLogs.entityType, entityType),
        inArray(auditLogs.entityId, entityIds),
        inArray(auditLogs.action, actions),
      ),
    )
    .orderBy(auditLogs.entityId, desc(auditLogs.createdAt), desc(auditLogs.id));
}
