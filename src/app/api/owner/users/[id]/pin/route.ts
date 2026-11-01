import { jsonData, readJson, routeWithParams } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { resetPinBody } from "@/modules/auth/schemas";
import { requireRole, resetPin } from "@/modules/auth/service";

// O-13 "Reset PIN" (FR-OW-05): the user's open sessions end.
export const POST = routeWithParams<{ id: string }>(
  async (request, { params }) => {
    assertSameOrigin(request);
    const actor = requireRole(await sessionFromRequest(request), ["owner"]);
    const { pin } = await readJson(request, resetPinBody);
    const { id } = await params;
    await resetPin(actor, { userId: id, pin });
    return jsonData({ userId: id });
  },
);
