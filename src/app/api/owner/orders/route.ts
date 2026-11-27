import { AppError } from "@/lib/errors";
import { jsonData, route } from "@/lib/http";
import { sessionFromRequest } from "@/modules/auth/request";
import { ownerOrdersQuery } from "@/modules/orders/schemas";
import { listOwnerOrders } from "@/modules/orders/service";

// O-12 (P3-01, FR-OW-08): the orders of one business day (?date=YYYY-MM-DD,
// default today), optionally searched (?q= queue number or payment ref).
export const GET = route(async (request) => {
  const params = request.nextUrl.searchParams;
  const parsed = ownerOrdersQuery.safeParse({
    date: params.get("date") || undefined,
    q: params.get("q") || undefined,
  });
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", { details: { fields: ["date"] } });
  }
  const list = await listOwnerOrders(
    await sessionFromRequest(request),
    parsed.data,
  );
  return jsonData(list, { headers: { "Cache-Control": "no-store" } });
});
