import { jsonData, readJson, route } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { ingredientBody } from "@/modules/inventory/schemas";
import {
  createIngredient,
  getOwnerIngredients,
} from "@/modules/inventory/service";

// O-05 (FR-IV-01): every ingredient, active or not, and the suppliers.
export const GET = route(async (request) => {
  const data = await getOwnerIngredients(await sessionFromRequest(request));
  return jsonData(data, { headers: { "Cache-Control": "no-store" } });
});

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const actor = requireRole(await sessionFromRequest(request), ["owner"]);
  const body = await readJson(request, ingredientBody);
  return jsonData(await createIngredient(actor, body), { status: 201 });
});
