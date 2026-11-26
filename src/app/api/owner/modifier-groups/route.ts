import { jsonData, readJson, route } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { modifierGroupBody } from "@/modules/menu/schemas";
import {
  createModifierGroup,
  getOwnerModifierGroups,
} from "@/modules/menu/service";

// O-04 (FR-OW-03): every group with its options, ingredient deltas and the
// items that offer it.
export const GET = route(async (request) => {
  const data = await getOwnerModifierGroups(await sessionFromRequest(request));
  return jsonData(data, { headers: { "Cache-Control": "no-store" } });
});

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const actor = requireRole(await sessionFromRequest(request), ["owner"]);
  const body = await readJson(request, modifierGroupBody);
  return jsonData(await createModifierGroup(actor, body), { status: 201 });
});
