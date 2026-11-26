import { jsonData, readJson, routeWithParams } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { recipeBody } from "@/modules/menu/schemas";
import { setRecipe } from "@/modules/menu/service";

// O-06 "Simpan resep" (FR-IV-02): replaces the item's recipe.
export const PUT = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    assertSameOrigin(request);
    const actor = requireRole(await sessionFromRequest(request), ["owner"]);
    const { lines } = await readJson(request, recipeBody);
    const { id } = await params;
    return jsonData(await setRecipe(actor, id, lines));
  },
);
