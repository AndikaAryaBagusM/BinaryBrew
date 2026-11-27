import { jsonData, route } from "@/lib/http";
import { sessionFromRequest } from "@/modules/auth/request";
import { getLowStock } from "@/modules/inventory/service";

// O-02 "Stok menipis" and the nav badge (FR-IV-06, P2-07): active
// ingredients at or below their minimum, worst first. Never cached.
export const GET = route(async (request) => {
  const items = await getLowStock(await sessionFromRequest(request));
  return jsonData({ items }, { headers: { "Cache-Control": "no-store" } });
});
