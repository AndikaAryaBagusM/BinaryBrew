import { routeWithParams } from "@/lib/http";
import { sseResponse } from "@/lib/sse";
import { subscribeToOrderEvents } from "@/modules/orders/events";
import { getOrderLiveState } from "@/modules/orders/service";

// SSE for one status link (Tech §6, §7): `order` events with {status,
// queueNumber}, the current state first, so a reconnect also catches up.
// 404 before streaming for an unknown link.
export const GET = routeWithParams<{ publicToken: string }>(
  async (request, { params }) => {
    const { publicToken } = await params;
    const { orderId } = await getOrderLiveState(publicToken);
    return sseResponse(request.signal, async (send) => {
      // Subscribe before reading, so no change falls in between.
      const unsubscribe = await subscribeToOrderEvents((event) => {
        if (event.orderId === orderId) {
          send("order", {
            status: event.status,
            queueNumber: event.queueNumber,
          });
        }
      });
      try {
        const { status, queueNumber } = await getOrderLiveState(publicToken);
        send("order", { status, queueNumber });
      } catch (error) {
        await unsubscribe();
        throw error;
      }
      return unsubscribe;
    });
  },
);
