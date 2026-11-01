import { jsonData, route } from "@/lib/http";
import { clearSessionCookie } from "@/modules/auth/cookies";
import { assertSameOrigin, sessionToken } from "@/modules/auth/request";
import { logout } from "@/modules/auth/service";

export const POST = route(async (request) => {
  assertSameOrigin(request);
  await logout(sessionToken(request));

  const response = jsonData({ loggedOut: true });
  clearSessionCookie(response);
  return response;
});
