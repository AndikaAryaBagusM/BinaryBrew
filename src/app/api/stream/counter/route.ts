import { route } from "@/lib/http";
import { sseResponse } from "@/lib/sse";
import { sessionFromRequest } from "@/modules/auth/request";
import { COUNTER_ROLES, requireRole } from "@/modules/auth/service";
import { subscribeToOrderEvents } from "@/modules/orders/events";

// SSE for the Counter (Tech §6, §7): an `order` event {orderId, status,
// queueNumber} for every change. `sync` follows once the stream is listening,
// so a refetch then cannot miss anything.
export const GET = route(async (request) => {
  requireRole(await sessionFromRequest(request), COUNTER_ROLES);
  return sseResponse(request.signal, async (send) => {
    const unsubscribe = await subscribeToOrderEvents((event) =>
      send("order", event),
    );
    send("sync", {});
    return unsubscribe;
  });
});
