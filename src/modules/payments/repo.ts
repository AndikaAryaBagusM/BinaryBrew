import { and, desc, eq } from "drizzle-orm";
import { type DbExecutor, getDb } from "@/db/client";
import { paymentEvents, payments, refunds } from "@/db/schema";

// SQL only; rules live in service.ts.

const chargeColumns = {
  id: payments.id,
  orderId: payments.orderId,
  method: payments.method,
  status: payments.status,
  amount: payments.amount,
  provider: payments.provider,
  providerRef: payments.providerRef,
  qrString: payments.qrString,
  expiresAt: payments.expiresAt,
};

export async function selectLatestPayment(
  orderId: string,
  db: DbExecutor = getDb(),
) {
  const [row] = await db
    .select(chargeColumns)
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  return row;
}

export async function selectPaymentById(id: string, db: DbExecutor = getDb()) {
  const [row] = await db
    .select(chargeColumns)
    .from(payments)
    .where(eq(payments.id, id));
  return row;
}

export async function selectPaymentByRef(
  provider: string,
  providerRef: string,
  db: DbExecutor,
) {
  const [row] = await db
    .select(chargeColumns)
    .from(payments)
    .where(
      and(
        eq(payments.provider, provider),
        eq(payments.providerRef, providerRef),
      ),
    );
  return row;
}

// Called with the order already locked, so rows lock orders → payments.
export async function lockPayment(id: string, db: DbExecutor) {
  const [row] = await db
    .select(chargeColumns)
    .from(payments)
    .where(eq(payments.id, id))
    .for("update");
  return row!;
}

// Undefined when the order already has a live payment
// (payments_one_live_per_order) or the reference exists.
export async function insertPayment(
  values: typeof payments.$inferInsert,
  db: DbExecutor = getDb(),
) {
  const [row] = await db
    .insert(payments)
    .values(values)
    .onConflictDoNothing()
    .returning(chargeColumns);
  return row;
}

export async function markPaymentPaid(id: string, now: Date, db: DbExecutor) {
  await db
    .update(payments)
    .set({ status: "paid", paidAt: now, updatedAt: now })
    .where(eq(payments.id, id));
}

// Undefined when (provider, event_id) was received before.
export async function insertPaymentEvent(
  values: {
    provider: string;
    eventId: string;
    payload: unknown;
    receivedAt: Date;
  },
  db: DbExecutor,
) {
  const [row] = await db
    .insert(paymentEvents)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: paymentEvents.id });
  return row;
}

export async function markEventProcessed(
  id: number,
  outcome: string,
  now: Date,
  db: DbExecutor,
) {
  await db
    .update(paymentEvents)
    .set({ processedAt: now, outcome })
    .where(eq(paymentEvents.id, id));
}

export async function insertRefund(
  values: typeof refunds.$inferInsert,
  db: DbExecutor,
) {
  const [row] = await db.insert(refunds).values(values).returning();
  return row!;
}

// The caller holds the order lock (orders before payments).
export async function expirePendingPayments(
  orderId: string,
  now: Date,
  db: DbExecutor,
) {
  return db
    .update(payments)
    .set({ status: "expired", updatedAt: now })
    .where(and(eq(payments.orderId, orderId), eq(payments.status, "pending")))
    .returning({
      provider: payments.provider,
      providerRef: payments.providerRef,
    });
}
