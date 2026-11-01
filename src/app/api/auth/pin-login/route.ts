import { jsonData, readJson, route } from "@/lib/http";
import { setSessionCookie } from "@/modules/auth/cookies";
import {
  assertSameOrigin,
  clientIp,
  deviceToken,
} from "@/modules/auth/request";
import { pinLoginBody } from "@/modules/auth/schemas";
import { pinLogin } from "@/modules/auth/service";

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const body = await readJson(request, pinLoginBody);
  const { token, user } = await pinLogin({
    ...body,
    deviceToken: deviceToken(request),
    ip: clientIp(request),
  });

  const response = jsonData({ user: { name: user.name, role: user.role } });
  setSessionCookie(response, token);
  return response;
});
