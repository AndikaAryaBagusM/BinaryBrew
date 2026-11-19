import { jsonData, readJson, route } from "@/lib/http";
import { assertSameOrigin, clientIp } from "@/modules/auth/request";
import { answerBody } from "@/modules/recommendations/schemas";
import {
  answerSuggestion,
  checkRecommendationRateLimit,
} from "@/modules/recommendations/service";

// FR-RC-04: "accepted" or "rejected" for a shown suggestion, from C-04 and
// the Counter row. Returns the event's id for the order to link.
export const POST = route(async (request) => {
  assertSameOrigin(request);
  const body = await readJson(request, answerBody);
  checkRecommendationRateLimit("answer", clientIp(request), body.clientSession);
  const { eventId } = await answerSuggestion(body);
  return jsonData(
    { eventId },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
});
