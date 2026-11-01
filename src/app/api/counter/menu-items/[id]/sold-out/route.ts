import { jsonData, readJson, routeWithParams } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { COUNTER_ROLES, requireRole } from "@/modules/auth/service";
import { soldOutBody } from "@/modules/menu/schemas";
import { setManualSoldOut } from "@/modules/menu/service";

// S-08 switch (FR-POS-04).
export const POST = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    assertSameOrigin(request);
    const actor = requireRole(await sessionFromRequest(request), COUNTER_ROLES);
    const { soldOut } = await readJson(request, soldOutBody);
    const { id } = await params;
    return jsonData(await setManualSoldOut(actor, { menuItemId: id, soldOut }));
  },
);
