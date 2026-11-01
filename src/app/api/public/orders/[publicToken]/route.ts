import { jsonData, routeWithParams } from "@/lib/http";
import { getPublicOrder } from "@/modules/orders/service";

// C-05/C-06/C-07 data for a status link (Tech §6). Polled every 10 s and
// refetched on every stream event, so never cached.
export const GET = routeWithParams<{ publicToken: string }>(
  async (_request, { params }) => {
    const { publicToken } = await params;
    const order = await getPublicOrder(publicToken);
    return jsonData(order, { headers: { "Cache-Control": "no-store" } });
  },
);
