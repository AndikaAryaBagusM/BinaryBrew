import { jsonData, readJson, routeWithParams } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { categoryPatch } from "@/modules/menu/schemas";
import { updateCategory } from "@/modules/menu/service";

// O-03: rename a category or switch it off (FR-OW-02).
export const PATCH = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    assertSameOrigin(request);
    const actor = requireRole(await sessionFromRequest(request), ["owner"]);
    const patch = await readJson(request, categoryPatch);
    const { id } = await params;
    return jsonData(await updateCategory(actor, id, patch));
  },
);
