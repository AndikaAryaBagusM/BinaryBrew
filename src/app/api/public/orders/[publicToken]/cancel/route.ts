import { jsonData, routeWithParams } from "@/lib/http";
import { assertSameOrigin } from "@/modules/auth/request";
import { cancelSelfOrder } from "@/modules/orders/service";

// C-05 "Kembali ke keranjang": expires the order if it is still unpaid and
// answers its status either way.
export const POST = routeWithParams<{ publicToken: string }>(
  async (request, { params }) => {
    assertSameOrigin(request);
    const { publicToken } = await params;
    const { status } = await cancelSelfOrder(publicToken);
    return jsonData({ status }, { headers: { "Cache-Control": "no-store" } });
  },
);
