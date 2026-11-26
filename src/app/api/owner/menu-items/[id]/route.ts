import { jsonData, readJson, routeWithParams } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { menuItemPatch } from "@/modules/menu/schemas";
import { getOwnerItemDetails, updateMenuItem } from "@/modules/menu/service";

// O-06 tabs: the item's recipe and the groups it offers (P2-02).
export const GET = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    const { id } = await params;
    const data = await getOwnerItemDetails(
      await sessionFromRequest(request),
      id,
    );
    return jsonData(data, { headers: { "Cache-Control": "no-store" } });
  },
);

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
