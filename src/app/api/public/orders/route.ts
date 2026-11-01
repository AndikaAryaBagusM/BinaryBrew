import { AppError } from "@/lib/errors";
import { jsonData, readJson, route } from "@/lib/http";
import { assertSameOrigin, clientIp } from "@/modules/auth/request";
import { clientToken, createOrderBody } from "@/modules/orders/schemas";
import { checkOrderRateLimit, createSelfOrder } from "@/modules/orders/service";

// Self-order checkout (Tech §6). 201 for a new order, 200 when a retried
// request with the same Idempotency-Key returns the existing one. The payment
// charge is added in P1-07.
export const POST = route(async (request) => {
  assertSameOrigin(request);
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !clientToken.safeParse(idempotencyKey).success) {
    throw new AppError("VALIDATION_FAILED", {
      details: { fields: ["idempotency-key"] },
    });
  }
  const body = await readJson(request, createOrderBody);
  checkOrderRateLimit(clientIp(request), body.clientSession);

  const { order, replayed } = await createSelfOrder({
    ...body,
    idempotencyKey,
  });
  return jsonData(
    {
      publicToken: order.publicToken,
      status: order.status,
      total: order.total,
      expiresAt: order.expiresAt.toISOString(),
    },
    { status: replayed ? 200 : 201, headers: { "Cache-Control": "no-store" } },
  );
});
