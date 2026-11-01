import { jsonData, route } from "@/lib/http";
import { sessionFromRequest } from "@/modules/auth/request";
import { getCounterMenu } from "@/modules/menu/service";

// S-02 menu grid and S-08 (FR-POS-01, FR-POS-04). Never cached: prices and
// availability come from the database on every request.
export const GET = route(async (request) => {
  const menu = await getCounterMenu(await sessionFromRequest(request));
  return jsonData(menu, { headers: { "Cache-Control": "no-store" } });
});
