import { randomUUID } from "node:crypto";
import { type DbExecutor, getDb } from "@/db/client";
import { AppError } from "@/lib/errors";
import { newPublicToken } from "@/lib/ids";
import { businessDate } from "@/lib/time";
import { createRateLimiter } from "@/modules/auth/rate-limit";
import {
  COUNTER_ROLES,
  requireRole,
  type SessionUser,
} from "@/modules/auth/service";
import { getOrderableItems, requireOrderingQr } from "@/modules/menu/service";
import {
  cancelCharges,
  ensureQrisCharge,
  expirePendingCharges,
  getOrderPayment,
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
  // Read before the transaction, so it never waits for a second connection
  // while holding the client lock.
  const { qrTokenId } = await requireOrderingQr(input.qrToken);
  return withCharge(
    await insertOrder(
      { ...input, channel: "self_order", qrTokenId, openOrderCap: true },
      now,
    ),
  );
}

// Walk-in order at the Counter (FR-POS-01, FR-POS-02, Flow §5.3): the same
// prices, options and availability as self-order, also while self-ordering
// is closed (E9), without the open-order cap, paid with the tablet's QRIS.
// clientSession is the tablet browser's own random id.
export type CounterOrderInput = Omit<SelfOrderInput, "qrToken">;

export async function createCounterOrder(
  actor: SessionUser | null,
  input: CounterOrderInput,
  { now = new Date() }: { now?: Date } = {},
): Promise<{
  order: CreatedOrder;
  payment: PaymentSummary | null;
  replayed: boolean;
}> {
  const user = requireRole(actor, COUNTER_ROLES);
  return withCharge(
    await insertOrder(
      { ...input, channel: "counter", createdBy: user.userId },
      now,
    ),
  );
}

// After commit, so the gateway call never runs while locks are held. A retry
// with the same key creates the charge if this step failed.
async function withCharge({
  order,
  replayed,
}: {
  order: CreatedOrder;
  replayed: boolean;
}) {
  const payment = await ensureQrisCharge({
    orderId: order.id,
    orderStatus: order.status,
    amount: order.total,
    expiresAt: order.expiresAt,
  });
  return { order, payment, replayed };
}

type NewOrder = {
  clientSession: string;
  idempotencyKey: string;
  items: CartLine[];
} & (
  | { channel: "self_order"; qrTokenId: string; openOrderCap: true }
  | { channel: "counter"; createdBy: string }
);

async function insertOrder(
  input: NewOrder,
  now: Date,
): Promise<{ order: CreatedOrder; replayed: boolean }> {
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

    if (input.channel === "self_order") {
      const open = await repo.countOpenOrders(input.clientSession, now, tx);
      if (open >= MAX_OPEN_ORDERS) {
        throw new AppError("OPEN_ORDER_LIMIT", {
          details: { limit: MAX_OPEN_ORDERS },
        });
      }
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
        channel: input.channel,
        qrTokenId: input.channel === "self_order" ? input.qrTokenId : null,
        createdBy: input.channel === "counter" ? input.createdBy : null,
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
      lines.map((line, position) => ({
        id: line.id,
        position,
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
        line.modifiers.map((modifier, position) => ({
          orderItemId: line.id,
          position,
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

// Customer status link (C-05, C-06, C-07). The public token is the only key;
// the internal id never leaves the server.

const PUBLIC_TOKEN = /^[A-Za-z0-9_-]{22}$/;

export type OrderStatus = LockedOrder["status"];

export type PublicOrder = {
  publicToken: string;
  status: OrderStatus;
  queueNumber: number | null;
  createdAt: Date;
  paidAt: Date | null;
  expiresAt: Date | null;
  subtotal: number;
  serviceCharge: number;
  taxAmount: number;
  taxInclusive: boolean;
  total: number;
  items: {
    name: string;
    quantity: number;
    lineTotal: number;
    options: string[];
  }[];
  payment: {
    id: string;
    method: "qris_dynamic" | "qris_static_manual" | "cash";
    amount: number;
    qrString: string | null; // only while it can still be paid
    expiresAt: Date | null;
  } | null;
  menuPath: string | null; // null once the table's QR code is rotated
};

async function findByPublicToken(publicToken: string) {
  if (!PUBLIC_TOKEN.test(publicToken)) throw new AppError("NOT_FOUND");
  const row = await repo.selectByPublicToken(publicToken);
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

export async function getPublicOrder(
  publicToken: string,
): Promise<PublicOrder> {
  const { id, qrToken, ...order } = await findByPublicToken(publicToken);
  const [items, payment] = await Promise.all([
    repo.selectOrderLines(id),
    getOrderPayment(id),
  ]);
  const payable =
    order.status === "awaiting_payment" && payment?.status === "pending";
  return {
    ...order,
    items,
    payment: payment
      ? {
          id: payment.id,
          method: payment.method,
          amount: payment.amount,
          qrString: payable ? payment.qrString : null,
          expiresAt: payment.expiresAt,
        }
      : null,
    menuPath: qrToken ? `/o/${qrToken}` : null,
  };
}

// For the SSE stream: which order_events belong to this link, and its state
// right now.
export async function getOrderLiveState(publicToken: string) {
  const { id, status, queueNumber } = await findByPublicToken(publicToken);
  return { orderId: id, status, queueNumber };
}

// C-05 "Kembali ke keranjang": an unpaid self-order expires now, so it stops
// counting toward the open-order cap. Anything else is left as it is (BR-06)
// and its status returned, so repeating the call is safe.
export async function cancelSelfOrder(
  publicToken: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ status: OrderStatus }> {
  if (!PUBLIC_TOKEN.test(publicToken)) throw new AppError("NOT_FOUND");
  const { status, providerRefs } = await getDb().transaction(async (tx) => {
    const order = await repo.lockByPublicToken(publicToken, tx);
    if (!order) throw new AppError("NOT_FOUND");
    if (order.status !== "awaiting_payment" || order.channel !== "self_order") {
      return { status: order.status, providerRefs: [] };
    }
    const providerRefs = await expireOrder(order.id, now, tx);
    return { status: "expired" as const, providerRefs };
  });
  await cancelCharges(providerRefs);
  return { status };
}

// S-04 "Batalkan": an unpaid counter order expires now, with its charge. Like
// cancelSelfOrder, anything else is left as it is and its status returned:
// the customer may have paid a moment earlier.
export async function cancelCounterOrder(
  actor: SessionUser | null,
  orderId: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<{ status: OrderStatus }> {
  requireRole(actor, COUNTER_ROLES);
  if (!UUID.test(orderId)) throw new AppError("NOT_FOUND");
  const { status, providerRefs } = await getDb().transaction(async (tx) => {
    const order = await repo.lockOrder(orderId, tx);
    if (!order) throw new AppError("NOT_FOUND");
    if (order.status !== "awaiting_payment" || order.channel !== "counter") {
      return { status: order.status, providerRefs: [] };
    }
    const providerRefs = await expireOrder(order.id, now, tx);
    return { status: "expired" as const, providerRefs };
  });
  await cancelCharges(providerRefs);
  return { status };
}

// S-04 and S-06 (FR-POS-05): one order with its lines, totals, payment and
// times, for any channel.
export type CounterOrderDetail = {
  id: string;
  publicToken: string;
  queueNumber: number | null;
  status: OrderStatus;
  channel: "self_order" | "counter";
  table: string | null;
  createdByName: string | null;
  subtotal: number;
  serviceCharge: number;
  taxAmount: number;
  taxInclusive: boolean;
  total: number;
  createdAt: Date;
  expiresAt: Date | null;
  paidAt: Date | null;
  preparingAt: Date | null;
  readyAt: Date | null;
  completedAt: Date | null;
  items: {
    name: string;
    quantity: number;
    lineTotal: number;
    options: string[];
  }[];
  payment: {
    id: string;
    method: "qris_dynamic" | "qris_static_manual" | "cash";
    status: "pending" | "paid" | "failed" | "expired" | "refunded";
    amount: number;
    qrString: string | null; // only while the charge is pending
    expiresAt: Date | null;
    paidAt: Date | null;
    reference: string | null; // manual reference, else the gateway's
  } | null;
};

export async function getCounterOrder(
  actor: SessionUser | null,
  orderId: string,
): Promise<CounterOrderDetail> {
  requireRole(actor, COUNTER_ROLES);
  if (!UUID.test(orderId)) throw new AppError("NOT_FOUND");
  const order = await repo.selectCounterOrder(orderId);
  if (!order) throw new AppError("NOT_FOUND");
  const [lines, payment] = await Promise.all([
    repo.selectOrderLines(order.id),
    getOrderPayment(order.id),
  ]);
  return {
    ...order,
    items: lines,
    payment: payment
      ? {
          id: payment.id,
          method: payment.method,
          status: payment.status,
          amount: payment.amount,
          qrString: payment.status === "pending" ? payment.qrString : null,
          expiresAt: payment.expiresAt,
          paidAt: payment.paidAt,
          reference: payment.manualReference ?? payment.providerRef,
        }
      : null,
  };
}

// Schema §5.3 expiry, shared with the sweep (P1-09). The caller holds the
// order lock; order_events hears it on commit. Returns the charges to cancel
// at the provider after commit (cancelCharges).
export async function expireOrder(
  orderId: string,
  now: Date,
  db: DbExecutor,
): Promise<string[]> {
  await repo.markOrderExpired(orderId, now, db);
  const providerRefs = await expirePendingCharges(orderId, now, db);
  await repo.notifyOrderEvents(
    { orderId, status: "expired", queueNumber: null },
    db,
  );
  return providerRefs;
}

// Sweep (Schema §5.3, FR-PM-04). Each order is its own transaction; one held
// by a payment in progress is skipped and seen again on the next run, and a
// payment that arrives after expiry follows the late-payment rule. Returns
// the expired order ids.
export async function expireOverdueOrders({
  now = new Date(),
}: { now?: Date } = {}): Promise<string[]> {
  const expired: string[] = [];
  for (const id of await repo.selectOverdueOrderIds(now, getDb())) {
    const providerRefs = await getDb().transaction(async (tx) => {
      if (!(await repo.lockOverdueOrder(id, now, tx))) return null;
      return expireOrder(id, now, tx);
    });
    if (!providerRefs) continue;
    expired.push(id);
    await cancelCharges(providerRefs);
  }
  return expired;
}

// Sweep (Schema §5.3, FR-QF-05): Ready orders nobody marked collected.
// Returns the completed order ids.
export async function completeStaleReadyOrders({
  now = new Date(),
}: { now?: Date } = {}): Promise<string[]> {
  const { ready_auto_complete_minutes: minutes } = await getSettings([
    "ready_auto_complete_minutes",
  ]);
  const readyBefore = new Date(now.getTime() - minutes * 60_000);
  return getDb().transaction(async (tx) => {
    const completed = await repo.markReadyOrdersCompleted(readyBefore, now, tx);
    for (const { id, queueNumber } of completed) {
      await repo.notifyOrderEvents(
        { orderId: id, status: "completed", queueNumber },
        tx,
      );
    }
    return completed.map((row) => row.id);
  });
}

// Counter queue (FR-QF-02, S-02).

export type QueueStatus = "paid" | "preparing" | "ready";

export type CounterOrder = {
  id: string;
  queueNumber: number;
  status: QueueStatus;
  channel: "self_order" | "counter";
  paidAt: Date;
  preparingAt: Date | null;
  readyAt: Date | null;
  items: { name: string; quantity: number; options: string[] }[];
};

export async function listCounterQueue(
  actor: SessionUser | null,
): Promise<CounterOrder[]> {
  requireRole(actor, COUNTER_ROLES);
  const rows = await repo.selectCounterQueue();
  const lines = await repo.selectLinesOfOrders(rows.map((row) => row.id));
  // Paid orders always have a number and a payment time (orders checks).
  return rows.map((row) => ({
    ...row,
    queueNumber: row.queueNumber!,
    status: row.status as QueueStatus,
    paidAt: row.paidAt!,
    items: (lines.get(row.id) ?? []).map(({ name, quantity, options }) => ({
      name,
      quantity,
      options,
    })),
  }));
}

const NEXT_STATUS: Partial<Record<OrderStatus, CounterStatus>> = {
  paid: "preparing",
  preparing: "ready",
  ready: "completed",
};
export type CounterStatus = "preparing" | "ready" | "completed";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Start → Ready → Collected, one step at a time (Schema §5.3, BR-01). The
// row lock makes a second tap on the same order wait and then see the new
// status: it gets ORDER_STATUS_CHANGED with that status (Flow E18).
export async function advanceOrderStatus(
  actor: SessionUser | null,
  input: { orderId: string; status: CounterStatus },
  { now = new Date() }: { now?: Date } = {},
): Promise<{ status: CounterStatus; queueNumber: number | null }> {
  requireRole(actor, COUNTER_ROLES);
  if (!UUID.test(input.orderId)) throw new AppError("NOT_FOUND");
  return getDb().transaction(async (tx) => {
    const order = await repo.lockOrder(input.orderId, tx);
    if (!order) throw new AppError("NOT_FOUND");
    if (NEXT_STATUS[order.status] !== input.status) {
      throw new AppError("ORDER_STATUS_CHANGED", {
        details: { status: order.status },
      });
    }
    const queueNumber = await repo.setOrderStatus(
      order.id,
      input.status,
      now,
      tx,
    );
    await repo.notifyOrderEvents(
      { orderId: order.id, status: input.status, queueNumber },
      tx,
    );
    return { status: input.status, queueNumber };
  });
}
