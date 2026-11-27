import { getDb, type DbExecutor } from "@/db/client";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { randomToken } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { audit, latestAuditByEntity } from "@/modules/audit/service";
import {
  COUNTER_ROLES,
  consumeElevation,
  getUserNames,
  requireRole,
  type SessionUser,
} from "@/modules/auth/service";
import {
  lockOrderForPayment,
  markOrderPaid,
  orderItemsStillAvailable,
} from "@/modules/orders/service";
import { getSettings } from "@/modules/settings/service";
import type { PaymentProvider, VerifiedPaymentEvent } from "./provider";
import { createMockProvider, signMockEvent } from "./providers/mock";
import * as repo from "./repo";

// QRIS payments (FR-PM-01..03, FR-PM-05, FR-PM-07, Schema §5.2). The browser
// never marks anything paid: only a verified gateway event does, or a staff
// member confirming a static-QR payment by hand (audited, owner PIN).

// One provider per process, built from the (cached) environment.
let provider: PaymentProvider | undefined;

export function getPaymentProvider(): PaymentProvider {
  provider ??= createProvider();
  return provider;
}

function createProvider(): PaymentProvider {
  const env = getEnv();
  switch (env.PAYMENT_PROVIDER) {
    case "mock":
      return createMockProvider(env.PAYMENT_WEBHOOK_SECRET);
  }
}

export type PaymentSummary = {
  id: string;
  qrString: string | null;
  amount: number;
  expiresAt: Date | null;
};

const summary = ({ id, qrString, amount, expiresAt }: PaymentSummary) => ({
  id,
  qrString,
  amount,
  expiresAt,
});

// The order's charge, created once. Null for an order that is no longer
// awaiting payment and never got one. The order id is the gateway's
// idempotency key, so retries and parallel calls give one charge.
export async function ensureQrisCharge(order: {
  orderId: string;
  orderStatus: string;
  amount: number;
  expiresAt: Date;
}): Promise<PaymentSummary | null> {
  const existing = await repo.selectLatestPayment(order.orderId);
  if (existing) return summary(existing);
  if (order.orderStatus !== "awaiting_payment") return null;

  const provider = getPaymentProvider();
  const charge = await provider.createQrisCharge({
    orderId: order.orderId,
    amount: order.amount,
    expiresAt: order.expiresAt,
    idempotencyKey: order.orderId,
  });
  const inserted = await repo.insertPayment({
    orderId: order.orderId,
    method: "qris_dynamic",
    amount: order.amount,
    provider: provider.name,
    providerRef: charge.providerRef,
    qrString: charge.qrString,
    expiresAt: charge.expiresAt,
  });
  // Undefined when a parallel retry inserted it first.
  return summary(inserted ?? (await repo.selectLatestPayment(order.orderId))!);
}

export type PaymentOutcome =
  | "paid"
  | "revived" // late payment, items still available
  | "refund_requested" // late payment, an item is unavailable
  | "already_paid"
  | "duplicate" // event received before
  | "noted" // expired/failed: the expiry sweep owns state changes
  | "unknown_reference";

export const LATE_PAYMENT_REFUND_REASON = "paid after expiry, item unavailable";

// Verifies, records and applies one gateway event in a single transaction.
// A failure rolls everything back, event included, so the gateway's retry is
// processed again; a recorded event is never processed twice.
export async function handlePaymentWebhook(
  providerName: string,
  rawBody: string,
  headers: Headers,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ outcome: PaymentOutcome }> {
  const provider = getPaymentProvider();
  if (providerName !== provider.name) throw new AppError("NOT_FOUND");
  const event = provider.verifyWebhook(rawBody, headers);

  const result = await getDb().transaction(async (tx) => {
    const recorded = await repo.insertPaymentEvent(
      {
        provider: provider.name,
        eventId: event.eventId,
        payload: event.raw,
        receivedAt: now,
      },
      tx,
    );
    if (!recorded) return { outcome: "duplicate" as const };
    const applied = await applyEvent(provider.name, event, now, tx);
    await repo.markEventProcessed(recorded.id, applied.outcome, now, tx);
    return applied;
  });

  // Alerts after commit, so a rolled-back attempt raises none.
  if (result.outcome === "unknown_reference") {
    logger.error(
      { provider: provider.name, providerRef: event.providerRef },
      "payment event for an unknown reference",
    );
  } else if (result.outcome === "already_paid") {
    // A gateway sends a new event id only for a new payment, so this may be
    // a customer paying twice (docs/03 E4).
    logger.warn(
      { orderId: result.orderId, eventId: event.eventId },
      "paid event for an order that is already paid",
    );
  } else if (result.outcome === "refund_requested") {
    logger.warn(
      { orderId: result.orderId, refundId: result.refundId },
      "late payment for an unavailable order: refund requested",
    );
  }
  return { outcome: result.outcome };
}

type Applied = {
  outcome: Exclude<PaymentOutcome, "duplicate">;
  orderId?: string;
  refundId?: string;
};

// Schema §5.2 steps 2-5.
async function applyEvent(
  providerName: string,
  event: VerifiedPaymentEvent,
  now: Date,
  tx: DbExecutor,
): Promise<Applied> {
  const found = await repo.selectPaymentByRef(
    providerName,
    event.providerRef,
    tx,
  );
  if (!found) return { outcome: "unknown_reference" };
  if (event.type !== "paid") return { outcome: "noted" };

  const order = (await lockOrderForPayment(found.orderId, tx))!;
  const payment = await repo.lockPayment(found.id, tx);
  const orderId = order.id;
  if (payment.status === "paid" || payment.status === "refunded") {
    return { outcome: "already_paid", orderId };
  }

  if (order.status === "awaiting_payment") {
    await repo.markPaymentPaid(payment.id, now, tx);
    await markOrderPaid(order, now, tx);
    return { outcome: "paid", orderId };
  }
  if (order.status !== "expired") return { outcome: "already_paid", orderId };

  // Late payment (FR-PM-07).
  await repo.markPaymentPaid(payment.id, now, tx);
  if (await orderItemsStillAvailable(order.id, tx)) {
    await markOrderPaid(order, now, tx);
    return { outcome: "revived", orderId };
  }
  const refund = await repo.insertRefund(
    {
      orderId,
      paymentId: payment.id,
      amount: payment.amount,
      reason: LATE_PAYMENT_REFUND_REASON,
    },
    tx,
  );
  await audit(
    {
      action: "refund.request",
      actor: null,
      entity: { type: "refund", id: refund.id },
      reason: LATE_PAYMENT_REFUND_REASON,
      metadata: { orderId, paymentId: payment.id, amount: payment.amount },
    },
    { db: tx },
  );
  return { outcome: "refund_requested", orderId, refundId: refund.id };
}

// Dev only (Tech §6): "the customer paid", sent as a signed event through the
// same verification and processing as a real webhook.
export async function mockPay(
  paymentId: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ outcome: PaymentOutcome }> {
  const env = getEnv();
  if (env.PAYMENT_PROVIDER !== "mock") throw new AppError("NOT_FOUND");
  const payment = await repo.selectPaymentById(paymentId);
  if (!payment?.providerRef || payment.provider !== "mock") {
    throw new AppError("NOT_FOUND");
  }
  const { body, headers } = signMockEvent(env.PAYMENT_WEBHOOK_SECRET, {
    eventId: `mock_evt_${randomToken(16)}`,
    providerRef: payment.providerRef,
    type: "paid",
  });
  return handlePaymentWebhook("mock", body, headers, { now });
}

// Demo step 8 (Plan §6, `npm run demo:replay-webhook`): one signed mock
// "paid" event for the charge, with a fixed event id, so it can be sent to
// the webhook route more than once. Mock provider only.
export async function signedMockPaidEvent(
  paymentId: string,
): Promise<{ body: string; headers: Headers }> {
  const env = getEnv();
  if (env.PAYMENT_PROVIDER !== "mock") throw new AppError("NOT_FOUND");
  const payment = await repo.selectPaymentById(paymentId);
  if (!payment?.providerRef || payment.provider !== "mock") {
    throw new AppError("NOT_FOUND");
  }
  return signMockEvent(env.PAYMENT_WEBHOOK_SECRET, {
    eventId: `mock_evt_${randomToken(16)}`,
    providerRef: payment.providerRef,
    type: "paid",
  });
}

// Schema §5.3: an expiring order takes its pending charge with it. Runs in the
// caller's transaction with the order locked; returns the charges to cancel
// at the provider after commit (cancelCharges).
export async function expirePendingCharges(
  orderId: string,
  now: Date,
  db: DbExecutor,
): Promise<string[]> {
  const expired = await repo.expirePendingPayments(orderId, now, db);
  const provider = getPaymentProvider().name;
  return expired
    .filter((row) => row.provider === provider && row.providerRef)
    .map((row) => row.providerRef!);
}

// Best effort (Tech §8): a charge left open at the gateway expires there too,
// and a payment that still arrives follows the late-payment rule.
export async function cancelCharges(providerRefs: string[]): Promise<void> {
  const provider = getPaymentProvider();
  for (const providerRef of providerRefs) {
    try {
      await provider.cancelCharge(providerRef);
    } catch (error) {
      logger.warn({ err: error, providerRef }, "could not cancel a charge");
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// S-05 (FR-PM-05, Flow §5.4): the customer paid with the stall's static QR
// and staff found the payment in the bank app. One transaction (order locked
// first): spend the owner's elevation when the setting asks for it, retire
// the dynamic charge, record a paid qris_static_manual payment, give the
// order its queue number and write the audit row. An expired order revives
// only while its items are still available, like a late payment (FR-PM-07).
export async function confirmManualPayment(
  actor: SessionUser | null,
  input: {
    orderId: string;
    reference: string;
    note?: string;
    elevationId?: string;
  },
  { now = new Date() }: { now?: Date } = {},
): Promise<{ status: "paid"; queueNumber: number; paymentId: string }> {
  const user = requireRole(actor, COUNTER_ROLES);
  if (!UUID.test(input.orderId)) throw new AppError("NOT_FOUND");
  const { manual_payment_requires_owner_pin: needsOwnerPin } =
    await getSettings(["manual_payment_requires_owner_pin"]);

  const result = await getDb().transaction(async (tx) => {
    const order = await lockOrderForPayment(input.orderId, tx);
    if (!order) throw new AppError("NOT_FOUND");
    if (order.status === "expired") {
      if (!(await orderItemsStillAvailable(order.id, tx))) {
        throw new AppError("ITEM_SOLD_OUT");
      }
    } else if (order.status !== "awaiting_payment") {
      throw new AppError("ORDER_STATUS_CHANGED", {
        details: { status: order.status },
      });
    }

    let elevation: { elevationId: string; ownerUserId: string } | null = null;
    if (needsOwnerPin) {
      if (!input.elevationId) throw new AppError("ELEVATION_REQUIRED");
      elevation = await consumeElevation(
        user,
        { elevationId: input.elevationId, scope: "manual_payment" },
        { now, db: tx },
      );
    }

    const providerRefs = await expirePendingCharges(order.id, now, tx);
    const payment = await repo.insertPayment(
      {
        orderId: order.id,
        method: "qris_static_manual",
        status: "paid",
        amount: order.total,
        paidAt: now,
        confirmedBy: user.userId,
        elevationId: elevation?.elevationId ?? null,
        manualReference: input.reference,
        manualNote: input.note || null,
      },
      tx,
    );
    // A paid payment is already there: a late payment that asked for a
    // refund keeps the order expired.
    if (!payment) {
      throw new AppError("ORDER_STATUS_CHANGED", {
        details: { status: order.status },
      });
    }
    const queueNumber = await markOrderPaid(order, now, tx);
    await audit(
      {
        action: "payment.manual_confirm",
        actor: user,
        entity: { type: "payment", id: payment.id },
        metadata: {
          orderId: order.id,
          amount: order.total,
          reference: input.reference,
          elevationId: elevation?.elevationId ?? null,
          ownerUserId: elevation?.ownerUserId ?? null,
        },
      },
      { db: tx, now },
    );
    return { queueNumber, paymentId: payment.id, providerRefs };
  });

  await cancelCharges(result.providerRefs);
  return {
    status: "paid",
    queueNumber: result.queueNumber,
    paymentId: result.paymentId,
  };
}

// --- Refunds (P3-01, FR-PM-08, Schema §5.4 steps 5-6) ---

// Void (orders module, inside the void transaction with the order locked):
// asks for the paid amount back. Null when no money came in (a paid order
// always has a payment; a zero total has nothing to return).
export async function requestVoidRefund(
  input: { orderId: string; userId: string; reason: string },
  db: DbExecutor,
): Promise<{ id: string; amount: number; paymentId: string } | null> {
  const payment = await repo.lockPaidPayment(input.orderId, db);
  if (!payment || payment.amount <= 0) return null;
  const refund = await repo.insertRefund(
    {
      orderId: input.orderId,
      paymentId: payment.id,
      amount: payment.amount,
      reason: input.reason,
      requestedBy: input.userId,
    },
    db,
  );
  return { id: refund.id, amount: refund.amount, paymentId: payment.id };
}

export type RefundSummary = {
  id: string;
  orderId: string;
  queueNumber: number | null;
  businessDate: string;
  amount: number;
  reason: string;
  status: "requested" | "processed";
  createdAt: Date;
  processedAt: Date | null;
  gatewayRef: string | null;
  paymentMethod: "qris_dynamic" | "qris_static_manual" | "cash";
  paymentRef: string | null;
  // late_payment: asked for by the system (Schema §5.2), requestedByName null.
  source: "void" | "late_payment";
  requestedByName: string | null;
  // The owner whose PIN allowed the void, and what happened to the stock.
  approvedVoidBy: string | null;
  stock: "returned" | "wasted" | "none";
  processedByName: string | null;
};

const PROCESSED_SHOWN = 50;

// O-12 "Refund": every open request, then the latest processed ones.
export async function listRefunds(
  actor: SessionUser | null,
): Promise<RefundSummary[]> {
  requireRole(actor, ["owner"]);
  const [open, done] = await Promise.all([
    repo.selectRefunds(repo.refundWhere.requested(), 500),
    repo.selectRefunds(repo.refundWhere.processed(), PROCESSED_SHOWN),
  ]);
  return describeRefunds([...open, ...done]);
}

// O-12 order detail: the refunds of these orders.
export async function getOrderRefunds(
  orderIds: string[],
): Promise<RefundSummary[]> {
  if (orderIds.length === 0) return [];
  return describeRefunds(
    await repo.selectRefunds(repo.refundWhere.ofOrders(orderIds), 500),
  );
}

async function describeRefunds(
  rows: Awaited<ReturnType<typeof repo.selectRefunds>>,
): Promise<RefundSummary[]> {
  const voids = await latestAuditByEntity(
    "order",
    rows.map((row) => row.orderId),
    ["order.void"],
  );
  const owners = await getUserNames(
    [...voids.values()].map((entry) => String(entry.metadata.ownerUserId)),
  );
  return rows.map(({ requestedById, approvedByName, ...row }) => {
    const entry = voids.get(row.orderId);
    const stock = entry?.metadata.stock;
    return {
      ...row,
      source: requestedById === null ? "late_payment" : "void",
      approvedVoidBy: entry
        ? (owners.get(String(entry.metadata.ownerUserId)) ?? null)
        : null,
      stock: stock === "returned" || stock === "wasted" ? stock : "none",
      processedByName: approvedByName,
    };
  });
}

// O-12 "Tandai sudah dikembalikan" (Schema §5.4 step 6): the owner refunded
// the money in the gateway dashboard (or by bank transfer for a static-QR
// payment) and records the gateway's refund id. Owner only, with the owner's
// own PIN (scope refund_processed); the payment becomes refunded.
export async function markRefundProcessed(
  actor: SessionUser | null,
  input: { refundId: string; gatewayRef: string; elevationId: string },
  { now = new Date() }: { now?: Date } = {},
): Promise<{ status: "processed" }> {
  const owner = requireRole(actor, ["owner"]);
  if (!UUID.test(input.refundId)) throw new AppError("NOT_FOUND");
  await getDb().transaction(async (tx) => {
    const refund = await repo.lockRefund(input.refundId, tx);
    if (!refund) throw new AppError("NOT_FOUND");
    if (refund.status !== "requested") {
      throw new AppError("REFUND_STATUS_CHANGED");
    }
    const elevation = await consumeElevation(
      owner,
      { elevationId: input.elevationId, scope: "refund_processed" },
      { now, db: tx },
    );
    await repo.markRefundProcessed(
      refund.id,
      { approvedBy: owner.userId, gatewayRef: input.gatewayRef, now },
      tx,
    );
    await repo.markPaymentRefunded(refund.paymentId, now, tx);
    await audit(
      {
        action: "refund.process",
        actor: owner,
        entity: { type: "refund", id: refund.id },
        metadata: {
          orderId: refund.orderId,
          paymentId: refund.paymentId,
          amount: refund.amount,
          gatewayRef: input.gatewayRef,
          elevationId: elevation.elevationId,
        },
      },
      { db: tx, now },
    );
  });
  return { status: "processed" };
}

// The order's latest payment, for the status screens.
export function getOrderPayment(orderId: string) {
  return repo.selectLatestPayment(orderId);
}

// The latest payment of each order, by order id (O-12 list).
export async function getLatestPayments(orderIds: string[]) {
  const rows = await repo.selectLatestPayments(orderIds);
  return new Map(rows.map((row) => [row.orderId, row]));
}

// Demo order history (FR-RC-07): the paid QRIS payment of each seeded order.
// No gateway is involved; provider "seed" marks them.
const SEED_INSERT_CHUNK = 1000;

export async function recordSeedPayments(
  rows: { orderId: string; amount: number; createdAt: Date; paidAt: Date }[],
  db: DbExecutor,
) {
  for (let start = 0; start < rows.length; start += SEED_INSERT_CHUNK) {
    await repo.insertPayments(
      rows.slice(start, start + SEED_INSERT_CHUNK).map((row) => ({
        ...row,
        method: "qris_dynamic" as const,
        status: "paid" as const,
        provider: "seed",
        updatedAt: row.paidAt,
      })),
      db,
    );
  }
}

// For replacing seeded orders, which have no refunds.
export function deleteSeedPayments(orderIds: string[], db: DbExecutor) {
  return repo.deletePaymentsOfOrders(orderIds, db);
}
