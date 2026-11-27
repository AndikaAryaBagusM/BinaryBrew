import { jsonData, routeWithParams } from "@/lib/http";
import { sessionFromRequest } from "@/modules/auth/request";
import { getOwnerOrder } from "@/modules/orders/service";

// O-12 detail (P3-01): lines, payment, times, void and refunds.
export const GET = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    const { id } = await params;
    const order = await getOwnerOrder(await sessionFromRequest(request), id);
    return jsonData(order, { headers: { "Cache-Control": "no-store" } });
  },
);
