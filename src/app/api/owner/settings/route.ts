import { jsonData, readJson, route } from "@/lib/http";
import { assertSameOrigin, sessionFromRequest } from "@/modules/auth/request";
import { requireRole } from "@/modules/auth/service";
import { ownerSettingsBody } from "@/modules/settings/schemas";
import { getAllSettings, setSettings } from "@/modules/settings/service";

// O-14 basic (FR-OW-04). Read on every request: tax and service charge feed
// prices.
export const GET = route(async (request) => {
  requireRole(await sessionFromRequest(request), ["owner"]);
  return jsonData(
    { settings: await getAllSettings() },
    { headers: { "Cache-Control": "no-store" } },
  );
});

export const PUT = route(async (request) => {
  assertSameOrigin(request);
  const actor = requireRole(await sessionFromRequest(request), ["owner"]);
  const body = await readJson(request, ownerSettingsBody);
  return jsonData(await setSettings(actor, body));
});
