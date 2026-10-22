import { jsonData, readJson, route } from "@/lib/http";
import { setSessionCookie } from "@/modules/auth/cookies";
import { assertSameOrigin, clientIp } from "@/modules/auth/request";
import { ownerLoginBody } from "@/modules/auth/schemas";
import { ownerLogin } from "@/modules/auth/service";

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const body = await readJson(request, ownerLoginBody);
  const { token, user } = await ownerLogin({ ...body, ip: clientIp(request) });

  const response = jsonData({ user: { name: user.name, role: user.role } });
  setSessionCookie(response, token);
  return response;
});
