import { jsonData, readJson, route } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { supplierBody } from "@/modules/inventory/schemas";
import { createSupplier } from "@/modules/inventory/service";

// O-05 "Pemasok" panel. The list comes with GET /api/owner/ingredients.
export const POST = route(async (request) => {
  assertSameOrigin(request);
  const actor = requireRole(await sessionFromRequest(request), ["owner"]);
  const body = await readJson(request, supplierBody);
  return jsonData(await createSupplier(actor, body), { status: 201 });
});
