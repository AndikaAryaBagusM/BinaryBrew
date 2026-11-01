import { jsonData, readJson, route } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { categoryBody } from "@/modules/menu/schemas";
import { createCategory } from "@/modules/menu/service";

// O-03 categories (FR-OW-02); GET /api/owner/menu-items lists them.
export const POST = route(async (request) => {
  assertSameOrigin(request);
  const actor = requireRole(await sessionFromRequest(request), ["owner"]);
  const body = await readJson(request, categoryBody);
  return jsonData(await createCategory(actor, body), { status: 201 });
});
