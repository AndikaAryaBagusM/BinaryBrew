import { jsonData, readJson, routeWithParams } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { modifierOptionPatch } from "@/modules/menu/schemas";
import { updateModifierOption } from "@/modules/menu/service";

// O-04 option editor: name, price, default, switch off, ingredient deltas.
export const PATCH = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    assertSameOrigin(request);
    const actor = requireRole(await sessionFromRequest(request), ["owner"]);
    const patch = await readJson(request, modifierOptionPatch);
    const { id } = await params;
    return jsonData(await updateModifierOption(actor, id, patch));
  },
);
