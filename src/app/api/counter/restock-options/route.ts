import { jsonData, route } from "@/lib/http";
import { sessionFromRequest } from "@/modules/auth/request";
import { getRestockOptions } from "@/modules/inventory/service";

// S-09 and O-07 pickers: active ingredients with stock and average cost, and
// active suppliers. Never cached: the preview needs the current cost.
export const GET = route(async (request) => {
  const data = await getRestockOptions(await sessionFromRequest(request));
  return jsonData(data, { headers: { "Cache-Control": "no-store" } });
});
