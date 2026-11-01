import { jsonData, route } from "@/lib/http";
import { sessionFromRequest } from "@/modules/auth/request";
import { listCounterQueue } from "@/modules/orders/service";

// The S-02 queue column (Tech §6): paid orders not yet collected, oldest
// first. Never cached.
export const GET = route(async (request) => {
  const orders = await listCounterQueue(await sessionFromRequest(request));
  return jsonData({ orders }, { headers: { "Cache-Control": "no-store" } });
});
