import { jsonData, readJson, routeWithParams } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { refundProcessedBody } from "@/modules/payments/schemas";
import { markRefundProcessed } from "@/modules/payments/service";

// O-12 "Tandai sudah dikembalikan" (P3-01, Schema §5.4 step 6): owner only,
// with the owner's own PIN (scope refund_processed) and the gateway refund id.
export const POST = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    assertSameOrigin(request);
    const actor = requireRole(await sessionFromRequest(request), ["owner"]);
    const body = await readJson(request, refundProcessedBody);
    const { id } = await params;
    return jsonData(
      await markRefundProcessed(actor, { ...body, refundId: id }),
    );
  },
);
