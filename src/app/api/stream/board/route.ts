import { route } from "@/lib/http";
import { sseResponse } from "@/lib/sse";
import { subscribeToOrderEvents } from "@/modules/orders/events";

// SSE for the TV board (Tech §6, §7). Public, so it carries no order data: a
// bare `change` when an order enters, moves on or leaves the board, and
// `sync` once listening; the board then refetches GET /api/public/board.
const BOARD_CHANGES = new Set(["preparing", "ready", "completed", "voided"]);

export const GET = route(async (request) =>
  sseResponse(request.signal, async (send) => {
    const unsubscribe = await subscribeToOrderEvents((event) => {
      if (BOARD_CHANGES.has(event.status)) send("change", {});
    });
    send("sync", {});
    return unsubscribe;
  }),
);
