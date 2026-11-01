import { and, asc, count, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { type DbExecutor, getDb } from "@/db/client";
import { orderItemModifiers, orderItems, orders, qrTokens } from "@/db/schema";

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

// The order behind a status link, with its table's QR token while that code
// is still active.
export async function selectByPublicToken(
  publicToken: string,
  db: DbExecutor = getDb(),
) {
  const [row] = await db
    .select({
      id: orders.id,
      publicToken: orders.publicToken,
      status: orders.status,
      queueNumber: orders.queueNumber,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      expiresAt: orders.expiresAt,
      subtotal: orders.subtotal,
      serviceCharge: orders.serviceCharge,
      taxAmount: orders.taxAmount,
      taxInclusive: orders.taxInclusive,
      total: orders.total,
      qrToken: qrTokens.token,
    })
    .from(orders)
    .leftJoin(
      qrTokens,
      and(eq(qrTokens.id, orders.qrTokenId), eq(qrTokens.isActive, true)),
    )
    .where(eq(orders.publicToken, publicToken));
  return row;
}

export async function selectOrderLines(
  orderId: string,
  db: DbExecutor = getDb(),
) {
  return (await selectLinesOfOrders([orderId], db)).get(orderId) ?? [];
}

type OrderLine = {
  name: string;
  quantity: number;
  lineTotal: number;
  options: string[];
};

// Lines of several orders in two queries, by order id.
export async function selectLinesOfOrders(
  orderIds: string[],
  db: DbExecutor = getDb(),
): Promise<Map<string, OrderLine[]>> {
  const lines = new Map<string, OrderLine[]>();
  if (orderIds.length === 0) return lines;
  const items = await db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      name: orderItems.nameSnapshot,
      quantity: orderItems.quantity,
      lineTotal: orderItems.lineTotal,
    })
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds))
    .orderBy(asc(orderItems.position), asc(orderItems.id));
  const options =
    items.length === 0
      ? []
      : await db
          .select({
            orderItemId: orderItemModifiers.orderItemId,
            name: orderItemModifiers.optionNameSnapshot,
          })
          .from(orderItemModifiers)
          .where(
            inArray(
              orderItemModifiers.orderItemId,
              items.map((item) => item.id),
            ),
          )
          .orderBy(
            asc(orderItemModifiers.position),
            asc(orderItemModifiers.id),
          );
  for (const { id, orderId, ...item } of items) {
    const line = {
      ...item,
      options: options.filter((o) => o.orderItemId === id).map((o) => o.name),
    };
    const list = lines.get(orderId);
    if (list) list.push(line);
    else lines.set(orderId, [line]);
  }
  return lines;
}

export async function lockByPublicToken(publicToken: string, db: DbExecutor) {
  const [row] = await db
    .select({ id: orders.id, status: orders.status, channel: orders.channel })
    .from(orders)
    .where(eq(orders.publicToken, publicToken))
    .for("update");
  return row;
}

export async function markOrderExpired(id: string, now: Date, db: DbExecutor) {
  await db
    .update(orders)
    .set({ status: "expired", updatedAt: now })
    .where(eq(orders.id, id));
}

// Sweep (Schema §5.3): unpaid orders whose payment time has passed.
export async function selectOverdueOrderIds(now: Date, db: DbExecutor) {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(eq(orders.status, "awaiting_payment"), lte(orders.expiresAt, now)),
    )
    .orderBy(asc(orders.expiresAt));
  return rows.map((row) => row.id);
}

// Locks the order only if it is still overdue and nobody else holds it (a
// payment in progress); otherwise returns nothing.
export async function lockOverdueOrder(id: string, now: Date, db: DbExecutor) {
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.id, id),
        eq(orders.status, "awaiting_payment"),
        lte(orders.expiresAt, now),
      ),
    )
    .for("update", { skipLocked: true });
  return row;
}

// One statement, so each row is locked and its status checked again before
// it changes.
export async function markReadyOrdersCompleted(
  readyBefore: Date,
  now: Date,
  db: DbExecutor,
) {
  return db
    .update(orders)
    .set({ status: "completed", completedAt: now, updatedAt: now })
    .where(and(eq(orders.status, "ready"), lte(orders.readyAt, readyBefore)))
    .returning({ id: orders.id, queueNumber: orders.queueNumber });
}

// The Counter queue (FR-QF-02): paid orders not yet collected, oldest
// payment first.
export async function selectCounterQueue(db: DbExecutor = getDb()) {
  return db
    .select({
      id: orders.id,
      queueNumber: orders.queueNumber,
      status: orders.status,
      channel: orders.channel,
      paidAt: orders.paidAt,
      preparingAt: orders.preparingAt,
      readyAt: orders.readyAt,
    })
    .from(orders)
    .where(inArray(orders.status, ["paid", "preparing", "ready"]))
    .orderBy(asc(orders.paidAt), asc(orders.id));
}

const stampColumn = {
  preparing: "preparingAt",
  ready: "readyAt",
  completed: "completedAt",
} as const;

// The caller holds the order lock and has checked the step (Schema §5.3).
export async function setOrderStatus(
  id: string,
  status: keyof typeof stampColumn,
  now: Date,
  db: DbExecutor,
) {
  const [row] = await db
    .update(orders)
    .set({ status, [stampColumn[status]]: now, updatedAt: now })
    .where(eq(orders.id, id))
    .returning({ queueNumber: orders.queueNumber });
  return row!.queueNumber;
}
