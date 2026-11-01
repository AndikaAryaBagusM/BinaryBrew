import { jsonData, routeWithParams } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { COUNTER_ROLES, requireRole } from "@/modules/auth/service";
import { cancelCounterOrder } from "@/modules/orders/service";

// S-04 "Batalkan": an unpaid counter order expires. Returns the order's
// status, which is "paid" if the customer was quicker.
export const POST = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    assertSameOrigin(request);
    const actor = requireRole(await sessionFromRequest(request), COUNTER_ROLES);
    const { id } = await params;
    return jsonData(await cancelCounterOrder(actor, id));
  },
);
