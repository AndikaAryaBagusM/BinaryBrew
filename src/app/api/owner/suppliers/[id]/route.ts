import { jsonData, readJson, routeWithParams } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { supplierPatch } from "@/modules/inventory/schemas";
import { updateSupplier } from "@/modules/inventory/service";

// O-05 "Pemasok" panel: rename, note, switch off.
export const PATCH = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    assertSameOrigin(request);
    const actor = requireRole(await sessionFromRequest(request), ["owner"]);
    const patch = await readJson(request, supplierPatch);
    const { id } = await params;
    return jsonData(await updateSupplier(actor, id, patch));
  },
);
