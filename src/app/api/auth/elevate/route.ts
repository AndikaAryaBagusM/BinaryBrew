import { jsonData, readJson, route } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { elevateBody } from "@/modules/auth/schemas";
import { elevate, requireRole } from "@/modules/auth/service";

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const actor = requireRole(await sessionFromRequest(request), [
    "owner",
    "staff",
    "barista",
  ]);
  const body = await readJson(request, elevateBody);
  const { elevationId, expiresAt } = await elevate(actor, body);
  return jsonData({ elevationId, expiresAt: expiresAt.toISOString() });
});
