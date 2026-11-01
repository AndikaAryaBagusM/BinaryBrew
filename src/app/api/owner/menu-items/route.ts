import { jsonData, readJson, route } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { menuItemBody } from "@/modules/menu/schemas";
import { createMenuItem, getOwnerMenu } from "@/modules/menu/service";

// O-03 (FR-OW-02): every category and item, active or not.
export const GET = route(async (request) => {
  const menu = await getOwnerMenu(await sessionFromRequest(request));
  return jsonData(menu, { headers: { "Cache-Control": "no-store" } });
});

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const actor = requireRole(await sessionFromRequest(request), ["owner"]);
  const body = await readJson(request, menuItemBody);
  return jsonData(await createMenuItem(actor, body), { status: 201 });
});
