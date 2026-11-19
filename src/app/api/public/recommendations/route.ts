import { jsonData, readJson, route } from "@/lib/http";
import { assertSameOrigin, clientIp } from "@/modules/auth/request";
import { suggestBody } from "@/modules/recommendations/schemas";
import {
  checkRecommendationRateLimit,
  suggestItems,
} from "@/modules/recommendations/service";

// C-04 (FR-CO-05, Flow §7): up to reco_max_items suggestions for the cart,
// each logged as "shown". Never cached.
export const POST = route(async (request) => {
  assertSameOrigin(request);
  const body = await readJson(request, suggestBody);
  checkRecommendationRateLimit(
    "suggest",
    clientIp(request),
    body.clientSession,
  );
  const suggestions = await suggestItems(body);
  return jsonData(
    { suggestions },
    { headers: { "Cache-Control": "no-store" } },
  );
});
