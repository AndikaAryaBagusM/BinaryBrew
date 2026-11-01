import { jsonData, readJson, route } from "@/lib/http";
import {
  assertSameOrigin,
  clientIp,
  sessionFromRequest,
} from "@/modules/auth/request";
import { unlockBody } from "@/modules/auth/schemas";
import { unlock } from "@/modules/auth/service";

// The Counter lock overlay (Tech §9, Flow E11): the signed-in user's PIN, same
// session, so no cookie is set.
export const POST = route(async (request) => {
  assertSameOrigin(request);
  const actor = await sessionFromRequest(request);
  const { pin } = await readJson(request, unlockBody);
  await unlock(actor, { pin, ip: clientIp(request) });
  return jsonData({ unlocked: true });
});
