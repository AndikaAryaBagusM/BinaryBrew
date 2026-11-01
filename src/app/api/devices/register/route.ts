import { jsonData, readJson, route } from "@/lib/http";
import { setDeviceCookie } from "@/modules/auth/cookies";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { registerDeviceBody } from "@/modules/auth/schemas";
import { registerDevice, requireRole } from "@/modules/auth/service";

// Registers the browser making the request as a counter device (owner only).
export const POST = route(async (request) => {
  assertSameOrigin(request);
  const actor = requireRole(await sessionFromRequest(request), ["owner"]);
  const body = await readJson(request, registerDeviceBody);
  const { deviceToken, deviceId, name } = await registerDevice(actor, body);

  const response = jsonData(
    { device: { id: deviceId, name } },
    { status: 201 },
  );
  setDeviceCookie(response, deviceToken);
  return response;
});
