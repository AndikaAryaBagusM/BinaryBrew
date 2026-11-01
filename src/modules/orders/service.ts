import { randomUUID } from "node:crypto";
import { type DbExecutor, getDb } from "@/db/client";
import { AppError } from "@/lib/errors";
import { newPublicToken } from "@/lib/ids";
import { businessDate } from "@/lib/time";
import { createRateLimiter } from "@/modules/auth/rate-limit";
import { getOrderableItems, requireOrderingQr } from "@/modules/menu/service";
import {
  ensureQrisCharge,
  type PaymentSummary,
} from "@/modules/payments/service";
import { getSettings } from "@/modules/settings/service";
import { type CartLine, priceOrder } from "./pricing";
import * as repo from "./repo";

// Order creation (FR-CO-06, FR-CO-08, BR-03, BR-11, Schema §5.1). The server
// prices every order from the database; the client sends ids, options and
// quantities only.

export const MAX_OPEN_ORDERS = 3; // unpaid orders per client (BR-11)

// Tech §9: per IP and per client session, in process memory.
const ordersByIp = createRateLimiter({ limit: 10, windowMs: 60_000 });
const ordersByClient = createRateLimiter({ limit: 5, windowMs: 60_000 });

export function resetOrderRateLimits() {
  ordersByIp.clear();
  ordersByClient.clear();
}

// Every attempt counts, including refused ones.
export function checkOrderRateLimit(
  ip: string,
  clientSession: string,
  now = Date.now(),
) {
  if (
    ordersByIp.isLimited(ip, now) ||
    ordersByClient.isLimited(clientSession, now)
  ) {
    throw new AppError("RATE_LIMITED");
  }
  ordersByIp.hit(ip, now);
  ordersByClient.hit(clientSession, now);
}

export type SelfOrderInput = {
  qrToken: string;
  clientSession: string;
  idempotencyKey: string;
  items: CartLine[];
};

type OrderRow = Awaited<ReturnType<typeof repo.insertOrder>>;
export type CreatedOrder = Omit<OrderRow, "expiresAt"> & { expiresAt: Date };

// Every self-order has an expiry; the column is nullable for later states.
function created(row: OrderRow): CreatedOrder {
  return { ...row, expiresAt: row.expiresAt! };
}

// Creates a self-order awaiting payment with its QRIS charge, or returns the
// order already created with the same idempotency key by this client
// (replayed: true). payment is null only for a replayed order that is no
// longer awaiting payment and never got a charge.
export async function createSelfOrder(
  input: SelfOrderInput,
  { now = new Date() }: { now?: Date } = {},
): Promise<{
  order: CreatedOrder;
  payment: PaymentSummary | null;
  replayed: boolean;
}> {
  const { order, replayed } = await insertSelfOrder(input, now);
  // After commit, so the gateway call never runs while locks are held. A
  // retry with the same key creates the charge if this step failed.
  const payment = await ensureQrisCharge({
    orderId: order.id,
    orderStatus: order.status,
    amount: order.total,
    expiresAt: order.expiresAt,
  });
  return { order, payment, replayed };
}

async function insertSelfOrder(
  input: SelfOrderInput,
  now: Date,
): Promise<{ order: CreatedOrder; replayed: boolean }> {
  // Read before the transaction, so it never waits for a second connection
  // while holding the client lock.
  const { qrTokenId } = await requireOrderingQr(input.qrToken);
  const settings = await getSettings([
    "tax_rate_bps",
    "tax_inclusive",
    "service_charge_bps",
    "order_expiry_minutes",
    "business_day_cutoff",
  ]);

  return getDb().transaction(async (tx) => {
    await repo.lockClientSession(input.clientSession, tx);

    const existing = await repo.selectByIdempotencyKey(
      input.clientSession,
      input.idempotencyKey,
      tx,
    );
    if (existing) return { order: created(existing), replayed: true };

    const open = await repo.countOpenOrders(input.clientSession, now, tx);
    if (open >= MAX_OPEN_ORDERS) {
      throw new AppError("OPEN_ORDER_LIMIT", {
        details: { limit: MAX_OPEN_ORDERS },
      });
    }

    const items = await getOrderableItems(
      input.items.map((line) => line.menuItemId),
      tx,
    );
    // Named in request order, once each, so the cart can be corrected
    // before paying (FR-CO-06).
    const unavailable = [...new Set(input.items.map((l) => l.menuItemId))]
      .map((id) => items.find((item) => item.id === id))
      .filter((item) => item !== undefined && !item.isAvailable)
      .map((item) => ({ menuItemId: item!.id, name: item!.name }));
    if (unavailable.length > 0) {
      throw new AppError("ITEM_SOLD_OUT", { details: { items: unavailable } });
    }

    const priced = priceOrder(input.items, items, {
      taxRateBps: settings.tax_rate_bps,
      taxInclusive: settings.tax_inclusive,
      serviceChargeBps: settings.service_charge_bps,
    });
    // A QRIS charge must be more than zero (payments_amount_check).
    if (priced.total <= 0) {
      throw new AppError("VALIDATION_FAILED", {
        details: { reason: "zero_total" },
      });
    }

    const order = await repo.insertOrder(
      {
        publicToken: newPublicToken(),
        businessDate: businessDate(now, settings.business_day_cutoff),
        channel: "self_order",
        qrTokenId,
        clientSession: input.clientSession,
        idempotencyKey: input.idempotencyKey,
        subtotal: priced.subtotal,
        serviceChargeBps: priced.serviceChargeBps,
        serviceCharge: priced.serviceCharge,
        taxRateBps: priced.taxRateBps,
        taxAmount: priced.taxAmount,
        taxInclusive: priced.taxInclusive,
        total: priced.total,
        expiresAt: new Date(
          now.getTime() + settings.order_expiry_minutes * 60_000,
        ),
      },
      tx,
    );

    // Ids are made here so each line's options can point at it.
    const lines = priced.lines.map((line) => ({ ...line, id: randomUUID() }));
    await repo.insertOrderItems(
      lines.map((line) => ({
        id: line.id,
        orderId: order.id,
        menuItemId: line.menuItemId,
        nameSnapshot: line.name,
        unitPrice: line.unitPrice,
        modifiersTotal: line.modifiersTotal,
        quantity: line.quantity,
        lineTotal: line.lineTotal,
      })),
      tx,
    );
    // ingredient_deltas stays [] until recipes exist (Phase 2).
    await repo.insertOrderItemModifiers(
      lines.flatMap((line) =>
        line.modifiers.map((modifier) => ({
          orderItemId: line.id,
          modifierOptionId: modifier.optionId,
          groupNameSnapshot: modifier.groupName,
          optionNameSnapshot: modifier.optionName,
          priceDeltaSnapshot: modifier.priceDelta,
        })),
      ),
      tx,
    );

    return { order: created(order), replayed: false };
  });
}

// Payment side of Schema §5.2. The payments module calls these inside its
// transaction; orders are locked before payments.

export type LockedOrder = NonNullable<
  Awaited<ReturnType<typeof repo.lockOrder>>
>;

export function lockOrderForPayment(
  orderId: string,
  db: DbExecutor,
): Promise<LockedOrder | undefined> {
  return repo.lockOrder(orderId, db);
}

// Late payment (FR-PM-07): every ordered item must still be orderable.
export async function orderItemsStillAvailable(
  orderId: string,
  db: DbExecutor,
): Promise<boolean> {
  const ids = [...new Set(await repo.selectOrderMenuItemIds(orderId, db))];
  const items = await getOrderableItems(ids, db);
  return items.length === ids.length && items.every((i) => i.isAvailable);
}

// Marks the order paid with the next queue number of its business day.
// order.paid is emitted when the transaction commits.
export async function markOrderPaid(
  order: LockedOrder,
  now: Date,
  db: DbExecutor,
): Promise<number> {
  const queueNumber = await repo.markOrderPaid(
    order.id,
    order.businessDate,
    now,
    db,
  );
  await repo.notifyOrderEvents(
    { orderId: order.id, status: "paid", queueNumber },
    db,
  );
  return queueNumber;
}
