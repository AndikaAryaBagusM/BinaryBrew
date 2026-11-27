import { Suspense } from "react";
import { getHppReport } from "@/modules/reports/service";
import { asJson, ownerSessionOrLogin } from "../../../session";
import { type HppReportData, HppScreen } from "./hpp-screen";

// O-09 HPP and margin report (FR-HP-01, 02, 04; Figma 20:1649).
export default function OwnerHppPage() {
  return (
    <Suspense fallback={null}>
      <Hpp />
    </Suspense>
  );
}

async function Hpp() {
  const session = await ownerSessionOrLogin();
  // Same JSON shape as GET /api/owner/reports/hpp (the current month).
  const data = asJson<HppReportData>(await getHppReport(session));
  return <HppScreen initial={data} />;
}
