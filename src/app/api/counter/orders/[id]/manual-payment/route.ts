import { jsonData, readJson, routeWithParams } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { COUNTER_ROLES, requireRole } from "@/modules/auth/service";
import { manualPaymentBody } from "@/modules/payments/schemas";
import { confirmManualPayment } from "@/modules/payments/service";

// S-05 (FR-PM-05): 403 ELEVATION_REQUIRED until the owner's PIN was given
// (POST /api/auth/elevate) when the setting asks for it.
export const POST = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    assertSameOrigin(request);
    const actor = requireRole(await sessionFromRequest(request), COUNTER_ROLES);
    const body = await readJson(request, manualPaymentBody);
    const { id } = await params;
    return jsonData(
      await confirmManualPayment(actor, { ...body, orderId: id }),
    );
  },
);
