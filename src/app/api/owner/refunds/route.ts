import { jsonData, route } from "@/lib/http";
import { sessionFromRequest } from "@/modules/auth/request";
import { listRefunds } from "@/modules/payments/service";

// O-12 "Refund" (P3-01): every open refund request, then the latest
// processed ones.
export const GET = route(async (request) => {
  const refunds = await listRefunds(await sessionFromRequest(request));
  return jsonData({ refunds }, { headers: { "Cache-Control": "no-store" } });
});
