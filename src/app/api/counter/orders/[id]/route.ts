import { jsonData, routeWithParams } from "@/lib/http";
import { sessionFromRequest } from "@/modules/auth/request";
import { getCounterOrder } from "@/modules/orders/service";

// S-04 and S-06 (FR-POS-05): one order with lines, totals, payment and times.
export const GET = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    const { id } = await params;
    const order = await getCounterOrder(await sessionFromRequest(request), id);
    return jsonData(order, { headers: { "Cache-Control": "no-store" } });
  },
);
