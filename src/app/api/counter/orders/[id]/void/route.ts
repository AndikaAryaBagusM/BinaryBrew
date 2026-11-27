import { jsonData, readJson, routeWithParams } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { voidOrderBody } from "@/modules/orders/schemas";
import { VOID_ROLES, voidOrder } from "@/modules/orders/service";

// S-06 void (P3-01, FR-PM-08): owner or staff, with the owner's PIN
// (POST /api/auth/elevate, scope void_order) and a reason.
export const POST = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    assertSameOrigin(request);
    const actor = requireRole(await sessionFromRequest(request), VOID_ROLES);
    const body = await readJson(request, voidOrderBody);
    const { id } = await params;
    return jsonData(await voidOrder(actor, { ...body, orderId: id }));
  },
);
