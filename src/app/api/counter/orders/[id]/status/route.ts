import { jsonData, readJson, routeWithParams } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { COUNTER_ROLES, requireRole } from "@/modules/auth/service";
import { statusChangeBody } from "@/modules/orders/schemas";
import { advanceOrderStatus } from "@/modules/orders/service";

// Mulai / Siap / Diambil (FR-QF-02). 409 ORDER_STATUS_CHANGED with the
// current status when the order already moved (Flow E18).
export const POST = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    assertSameOrigin(request);
    const actor = requireRole(await sessionFromRequest(request), COUNTER_ROLES);
    const { status } = await readJson(request, statusChangeBody);
    const { id } = await params;
    return jsonData(await advanceOrderStatus(actor, { orderId: id, status }));
  },
);
