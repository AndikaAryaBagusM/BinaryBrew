import type { DbExecutor } from "@/db/client";
import { AppError } from "@/lib/errors";
import * as repo from "./repo";

// Every sensitive action writes one audit row (Tech §9, BR-07). Call audit()
// with the action's transaction (`db`) so the row exists only if the action
// commits. Rows are never changed afterwards.

// Names are "<entity>.<verb>"; add new ones as tasks need them.
export const auditActions = [
  "category.create",
  "category.update",
  "device.register",
  "elevation.grant",
  "menu_item.available",
  "menu_item.create",
  "menu_item.sold_out",
  "menu_item.update",
  "payment.manual_confirm",
  "refund.request",
  "setting.update",
  "user.create",
  "user.pin_reset",
] as const;
export type AuditAction = (typeof auditActions)[number];

export type AuditActor = { userId: string; deviceId: string | null };

export type AuditEntry = {
  action: AuditAction;
  actor: AuditActor | null; // null = the system (worker, webhook)
  entity?: { type: string; id: string };
  reason?: string;
  metadata?: Record<string, unknown>;
};

// Secrets must never reach the audit log (Tech §9); keys are checked at any depth.
const SENSITIVE_KEY = /pin|password|token|secret|cookie|authorization/i;

function assertNoSecrets(value: unknown, path: string) {
  if (value === null || typeof value !== "object") return;
  for (const [key, inner] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      throw new AppError("INTERNAL", {
        details: { reason: `audit metadata must not contain "${path}${key}"` },
      });
    }
    assertNoSecrets(inner, `${path}${key}.`);
  }
}

// `now` is the action's own clock (tests pass one); the database default
// is used otherwise.
export async function audit(
  entry: AuditEntry,
  { db, now }: { db?: DbExecutor; now?: Date } = {},
) {
  const metadata = entry.metadata ?? {};
  assertNoSecrets(metadata, "");
  return repo.insertAuditLog(
    {
      actorUserId: entry.actor?.userId ?? null,
      deviceId: entry.actor?.deviceId ?? null,
      action: entry.action,
      entityType: entry.entity?.type ?? null,
      entityId: entry.entity?.id ?? null,
      reason: entry.reason ?? null,
      metadata,
      createdAt: now,
    },
    db,
  );
}

// The newest of the given actions per entity, with who did it and when
// (S-08 "Ditandai habis oleh Dimas, 17.20").
export async function latestAuditByEntity(
  entityType: string,
  entityIds: string[],
  actions: readonly AuditAction[],
  { db }: { db?: DbExecutor } = {},
): Promise<
  Map<string, { action: AuditAction; actorName: string | null; at: Date }>
> {
  const rows = await repo.selectLatestByEntity(
    entityType,
    entityIds,
    [...actions],
    db,
  );
  return new Map(
    rows.map((row) => [
      row.entityId!,
      {
        action: row.action as AuditAction,
        actorName: row.actorName,
        at: row.createdAt,
      },
    ]),
  );
}
