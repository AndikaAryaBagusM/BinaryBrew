import { jsonData, readJson, route } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { createUserBody } from "@/modules/auth/schemas";
import { createUser, listUsers, requireRole } from "@/modules/auth/service";

// O-13 basic (FR-OW-05).
export const GET = route(async (request) => {
  const users = await listUsers(await sessionFromRequest(request));
  return jsonData({ users }, { headers: { "Cache-Control": "no-store" } });
});

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const actor = requireRole(await sessionFromRequest(request), ["owner"]);
  const body = await readJson(request, createUserBody);
  return jsonData(await createUser(actor, body), { status: 201 });
});
