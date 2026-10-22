import { jsonData, route } from "@/lib/http";
import { deviceToken } from "@/modules/auth/request";
import { listPinUsers } from "@/modules/auth/service";

// Names for the S-01 picker; only answers a registered counter device.
export const GET = route(async (request) => {
  const users = await listPinUsers(deviceToken(request));
  return jsonData({ users });
});
