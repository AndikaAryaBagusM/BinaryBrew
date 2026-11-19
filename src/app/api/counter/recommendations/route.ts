import { jsonData, readJson, route } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { COUNTER_ROLES, requireRole } from "@/modules/auth/service";
import { suggestBody } from "@/modules/recommendations/schemas";
import { suggestItems } from "@/modules/recommendations/service";

// S-02 suggestion row (Flow §5.3): the top suggestion for the walk-in cart,
// for the staff to offer. Asked after every cart change, so suggestions
// already shown for this cart reuse their "shown" event. Never cached.
export const POST = route(async (request) => {
  assertSameOrigin(request);
  requireRole(await sessionFromRequest(request), COUNTER_ROLES);
  const body = await readJson(request, suggestBody);
  const suggestions = await suggestItems({ ...body, limit: 1 });
  return jsonData(
    { suggestions },
    { headers: { "Cache-Control": "no-store" } },
  );
});
