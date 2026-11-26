import { jsonData, readJson, routeWithParams } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { modifierGroupPatch } from "@/modules/menu/schemas";
import { updateModifierGroup } from "@/modules/menu/service";

// O-04: rename, limits, switch off.
export const PATCH = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    assertSameOrigin(request);
    const actor = requireRole(await sessionFromRequest(request), ["owner"]);
    const patch = await readJson(request, modifierGroupPatch);
    const { id } = await params;
    return jsonData(await updateModifierGroup(actor, id, patch));
  },
);
