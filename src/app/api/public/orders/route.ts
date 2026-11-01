import { jsonData, readJson, route } from "@/lib/http";
import { assertSameOrigin, clientIp } from "@/modules/auth/request";
import { idempotencyKeyFrom } from "@/modules/orders/request";
import { createOrderBody } from "@/modules/orders/schemas";
import { checkOrderRateLimit, createSelfOrder } from "@/modules/orders/service";

// Self-order checkout (Tech §6). 201 for a new order, 200 when a retried
// request with the same Idempotency-Key returns the existing one, both with
// the order's QRIS charge.
export const POST = route(async (request) => {
  assertSameOrigin(request);
  const idempotencyKey = idempotencyKeyFrom(request);
  const body = await readJson(request, createOrderBody);
  checkOrderRateLimit(clientIp(request), body.clientSession);

  const { order, payment, replayed } = await createSelfOrder({
    ...body,
    idempotencyKey,
  });
  return jsonData(
    {
      publicToken: order.publicToken,
      status: order.status,
      total: order.total,
      expiresAt: order.expiresAt.toISOString(),
      // The id is used only by the mock provider's "simulate paid" button.
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
