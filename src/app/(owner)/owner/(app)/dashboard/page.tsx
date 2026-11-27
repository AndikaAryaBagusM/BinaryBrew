import { Suspense } from "react";
import { getLowStock } from "@/modules/inventory/service";
import { asJson, ownerSessionOrLogin } from "../../session";
import { DashboardScreen } from "./dashboard-screen";
import type { LowStockData } from "../owner-queries";

// O-02 Dasbor (Figma 18:502). P2-07 brings the "Stok menipis" card
// (FR-IV-06); sales, peak hours and best sellers follow in P3-03.
export default function OwnerDashboardPage() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const session = await ownerSessionOrLogin();
  // Same JSON shape as GET /api/owner/low-stock.
  const lowStock = asJson<LowStockData>({ items: await getLowStock(session) });
  return (
    <DashboardScreen today={new Date().toISOString()} lowStock={lowStock} />
  );
}
