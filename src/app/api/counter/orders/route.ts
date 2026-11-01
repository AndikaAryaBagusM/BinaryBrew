import { jsonData, readJson, route } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { COUNTER_ROLES, requireRole } from "@/modules/auth/service";
import { idempotencyKeyFrom } from "@/modules/orders/request";
import { counterOrderBody } from "@/modules/orders/schemas";
import { createCounterOrder, listCounterQueue } from "@/modules/orders/service";

// The S-02 queue column (Tech §6): paid orders not yet collected, oldest
// first. Never cached.
export const GET = route(async (request) => {
  const orders = await listCounterQueue(await sessionFromRequest(request));
  return jsonData({ orders }, { headers: { "Cache-Control": "no-store" } });
});

// Walk-in order (FR-POS-01, FR-POS-02): 201 for a new order, 200 when a
// retried request with the same Idempotency-Key returns it, both with the
// QRIS charge for S-04.
export const POST = route(async (request) => {
  assertSameOrigin(request);
  const actor = requireRole(await sessionFromRequest(request), COUNTER_ROLES);
  const idempotencyKey = idempotencyKeyFrom(request);
  const body = await readJson(request, counterOrderBody);
  const { order, payment, replayed } = await createCounterOrder(actor, {
    ...body,
    idempotencyKey,
  });
  return jsonData(
    {
      id: order.id,
      publicToken: order.publicToken,
      status: order.status,
      total: order.total,
      expiresAt: order.expiresAt.toISOString(),
      payment: payment && {
        id: payment.id,
        qrString: payment.qrString,
        amount: payment.amount,
        expiresAt: payment.expiresAt?.toISOString() ?? null,
      },
    },
    { status: replayed ? 200 : 201, headers: { "Cache-Control": "no-store" } },
  );
});
