import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { sessionFromRequest } from "@/modules/auth/request";
import { hppQuery } from "@/modules/reports/schemas";
import { getHppReportCsv } from "@/modules/reports/service";

// O-09 "Unduh CSV": the same report as a file.
export const GET = route(async (request) => {
  const parsed = hppQuery.safeParse({
    month: request.nextUrl.searchParams.get("month") ?? undefined,
  });
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", { details: { fields: ["month"] } });
  }
  const { filename, body } = await getHppReportCsv(
    await sessionFromRequest(request),
    { month: parsed.data.month },
  );
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
