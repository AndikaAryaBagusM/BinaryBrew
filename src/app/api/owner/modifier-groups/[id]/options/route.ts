import { jsonData, readJson, routeWithParams } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { modifierOptionBody } from "@/modules/menu/schemas";
import { createModifierOption } from "@/modules/menu/service";

// O-04 "Tambah opsi".
export const POST = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    assertSameOrigin(request);
    const actor = requireRole(await sessionFromRequest(request), ["owner"]);
    const body = await readJson(request, modifierOptionBody);
    const { id } = await params;
    return jsonData(await createModifierOption(actor, id, body), {
      status: 201,
    });
  },
);
