import { jsonData, readJson, routeWithParams } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { itemGroupsBody } from "@/modules/menu/schemas";
import { setItemGroups } from "@/modules/menu/service";

// O-06 "Pilihan" tab (FR-OW-03): the groups the item offers, in order.
export const PUT = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    assertSameOrigin(request);
    const actor = requireRole(await sessionFromRequest(request), ["owner"]);
    const { groupIds } = await readJson(request, itemGroupsBody);
    const { id } = await params;
    return jsonData(await setItemGroups(actor, id, groupIds));
  },
);
