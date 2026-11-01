import { jsonData, route } from "@/lib/http";
import { sessionFromRequest } from "@/modules/auth/request";
import { listDevices } from "@/modules/auth/service";

// O-13 basic: registered devices; registering uses POST /api/devices/register.
export const GET = route(async (request) => {
  const devices = await listDevices(await sessionFromRequest(request));
  return jsonData({ devices }, { headers: { "Cache-Control": "no-store" } });
});
