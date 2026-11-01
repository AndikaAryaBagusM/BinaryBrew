import { and, count, eq, gt, sql } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { orderItemModifiers, orderItems, orders } from "@/db/schema";

// SQL only; rules live in service.ts.

const createdOrderColumns = {
  id: orders.id,
  publicToken: orders.publicToken,
  status: orders.status,
  subtotal: orders.subtotal,
  serviceCharge: orders.serviceCharge,
  taxAmount: orders.taxAmount,
  total: orders.total,
  expiresAt: orders.expiresAt,
};

// Serialises order creation per browser until the transaction ends, so the
// open-order cap and the idempotency check cannot race (Schema §5.1 step 2).
export async function lockClientSession(clientSession: string, db: DbExecutor) {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${clientSession}, 0))`,
  );
}

export async function selectByIdempotencyKey(
  clientSession: string,
  idempotencyKey: string,
  db: DbExecutor,
) {
  const [row] = await db
    .select(createdOrderColumns)
    .from(orders)
    .where(
      and(
        eq(orders.clientSession, clientSession),
        eq(orders.idempotencyKey, idempotencyKey),
      ),
    );
  return row;
}

// Unpaid orders whose payment time has not passed yet.
export async function countOpenOrders(
  clientSession: string,
  now: Date,
  db: DbExecutor,
): Promise<number> {
  const [row] = await db
    .select({ open: count() })
    .from(orders)
    .where(
      and(
        eq(orders.clientSession, clientSession),
        eq(orders.status, "awaiting_payment"),
        gt(orders.expiresAt, now),
      ),
    );
  return row?.open ?? 0;
}

export async function insertOrder(
  values: typeof orders.$inferInsert,
  db: DbExecutor,
) {
  const [row] = await db
    .insert(orders)
    .values(values)
    .returning(createdOrderColumns);
  return row!;
}

export async function insertOrderItems(
  values: (typeof orderItems.$inferInsert)[],
  db: DbExecutor,
) {
  if (values.length > 0) await db.insert(orderItems).values(values);
}

export async function insertOrderItemModifiers(
  values: (typeof orderItemModifiers.$inferInsert)[],
  db: DbExecutor,
) {
  if (values.length > 0) await db.insert(orderItemModifiers).values(values);
}
