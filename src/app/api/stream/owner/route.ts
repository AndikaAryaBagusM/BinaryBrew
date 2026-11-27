import { route } from "@/lib/http";
import { sseResponse } from "@/lib/sse";
import { sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { subscribeToStockEvents } from "@/modules/inventory/events";

// SSE for owner pages (Tech §7, P2-07): `stock` when a sale makes an
// ingredient low ({ingredientIds}); `sync` once listening, so a refetch then
// cannot miss anything. Pages refetch GET /api/owner/low-stock.
export const GET = route(async (request) => {
  requireRole(await sessionFromRequest(request), ["owner"]);
  return sseResponse(request.signal, async (send) => {
    const unsubscribe = await subscribeToStockEvents((event) =>
      send("stock", { ingredientIds: event.ingredientIds }),
    );
    send("sync", {});
    return unsubscribe;
  });
});
