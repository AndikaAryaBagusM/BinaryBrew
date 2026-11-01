import { jsonData, readJson, routeWithParams } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { menuItemPatch } from "@/modules/menu/schemas";
import { updateMenuItem } from "@/modules/menu/service";

// O-03 edit panel and the "Promosikan" switch (FR-OW-02, FR-RC-05).
export const PATCH = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    assertSameOrigin(request);
    const actor = requireRole(await sessionFromRequest(request), ["owner"]);
    const patch = await readJson(request, menuItemPatch);
    const { id } = await params;
    return jsonData(await updateMenuItem(actor, id, patch));
  },
);
