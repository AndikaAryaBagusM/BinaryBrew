import { z } from "zod";
import { AppError } from "@/lib/errors";
import { jsonData, routeWithParams } from "@/lib/http";
import { assertSameOrigin } from "@/modules/auth/request";
import { mockPay } from "@/modules/payments/service";

// Dev only (Tech §6): the payment screen's "simulate paid" button. 404 unless
// PAYMENT_PROVIDER is mock.
export const POST = routeWithParams<{ paymentId: string }>(
  async (request, { params }) => {
    assertSameOrigin(request);
    const { paymentId } = await params;
    if (!z.uuid().safeParse(paymentId).success) {
      throw new AppError("VALIDATION_FAILED", {
        details: { fields: ["paymentId"] },
      });
    }
    const { outcome } = await mockPay(paymentId);
    return jsonData({ outcome }, { headers: { "Cache-Control": "no-store" } });
  },
);
