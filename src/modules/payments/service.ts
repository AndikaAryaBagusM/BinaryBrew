import { getDb, type DbExecutor } from "@/db/client";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { randomToken } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { audit } from "@/modules/audit/service";
import {
  lockOrderForPayment,
  markOrderPaid,
  orderItemsStillAvailable,
} from "@/modules/orders/service";
import type { PaymentProvider, VerifiedPaymentEvent } from "./provider";
import { createMockProvider, signMockEvent } from "./providers/mock";
import * as repo from "./repo";

// QRIS payments (FR-PM-01..03, FR-PM-07, Schema §5.2). The browser never
// marks anything paid: only a verified gateway event does.

export function getPaymentProvider(): PaymentProvider {
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
