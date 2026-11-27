import { jsonData, readJson, route } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { restockBody } from "@/modules/inventory/schemas";
import { RESTOCK_ROLES, recordRestocks } from "@/modules/inventory/service";

// S-09 and O-07 (FR-IV-05): record purchases; staff and the owner.
export const POST = route(async (request) => {
  assertSameOrigin(request);
  const actor = requireRole(await sessionFromRequest(request), RESTOCK_ROLES);
  const body = await readJson(request, restockBody);
  return jsonData(await recordRestocks(actor, body), { status: 201 });
});
