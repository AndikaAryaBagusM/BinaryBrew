import { jsonData, readJson, routeWithParams } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { ingredientPatch } from "@/modules/inventory/schemas";
import { updateIngredient } from "@/modules/inventory/service";

// O-05 edit: name, kind, unit (until it is in use), minimum, active.
export const PATCH = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    assertSameOrigin(request);
    const actor = requireRole(await sessionFromRequest(request), ["owner"]);
    const patch = await readJson(request, ingredientPatch);
    const { id } = await params;
    return jsonData(await updateIngredient(actor, id, patch));
  },
);
