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

export async function lockOrder(id: string, db: DbExecutor) {
  const [row] = await db
    .select({
      id: orders.id,
      status: orders.status,
      businessDate: orders.businessDate,
    })
    .from(orders)
    .where(eq(orders.id, id))
    .for("update");
  return row;
}

export async function selectOrderMenuItemIds(orderId: string, db: DbExecutor) {
  const rows = await db
    .select({ menuItemId: orderItems.menuItemId })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  return rows.map((row) => row.menuItemId);
}

// next_queue_number() locks the day's counter row until commit, so parallel
// payments get unique, gapless numbers (BR-04).
export async function markOrderPaid(
  id: string,
  businessDate: string,
  now: Date,
  db: DbExecutor,
): Promise<number> {
  const [row] = await db
    .update(orders)
    .set({
      status: "paid",
      paidAt: now,
      queueNumber: sql`next_queue_number(${businessDate}::date)`,
      updatedAt: now,
    })
    .where(eq(orders.id, id))
    .returning({ queueNumber: orders.queueNumber });
  return row!.queueNumber!;
}

// Delivered to listeners when the transaction commits (Tech §7).
export async function notifyOrderEvents(payload: object, db: DbExecutor) {
  await db.execute(
    sql`select pg_notify('order_events', ${JSON.stringify(payload)})`,
  );
}
