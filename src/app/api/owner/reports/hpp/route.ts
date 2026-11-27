import { AppError } from "@/lib/errors";
import { jsonData, route } from "@/lib/http";
import { sessionFromRequest } from "@/modules/auth/request";
import { hppQuery } from "@/modules/reports/schemas";
import { getHppReport } from "@/modules/reports/service";

// O-09 (FR-HP-01, 02, 04): current HPP and margin per item, and sales of one
// month (?month=YYYY-MM, default the current one). Never cached.
export const GET = route(async (request) => {
  const parsed = hppQuery.safeParse({
    month: request.nextUrl.searchParams.get("month") ?? undefined,
  });
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", { details: { fields: ["month"] } });
  }
  const report = await getHppReport(await sessionFromRequest(request), {
    month: parsed.data.month,
  });
  return jsonData(report, { headers: { "Cache-Control": "no-store" } });
});
