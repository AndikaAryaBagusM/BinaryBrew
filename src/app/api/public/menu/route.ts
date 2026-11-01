import { z } from "zod";
import { AppError } from "@/lib/errors";
import { jsonData, route } from "@/lib/http";
import { getPublicMenu } from "@/modules/menu/service";

const query = z.object({ qr: z.string().min(1) });

// C-01 menu for a QR token. Never cached: prices and sold-out change any time.
export const GET = route(async (request) => {
  const parsed = query.safeParse({
    qr: request.nextUrl.searchParams.get("qr") ?? undefined,
  });
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", { details: { fields: ["qr"] } });
  }
  const menu = await getPublicMenu(parsed.data.qr);
  return jsonData(menu, { headers: { "Cache-Control": "no-store" } });
});
