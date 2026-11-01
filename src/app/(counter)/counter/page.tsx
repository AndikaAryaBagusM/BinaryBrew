import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { QueryProvider } from "@/components/query-provider";
import { getEnv } from "@/lib/env";
import { sessionFromCookies } from "@/modules/auth/server";
import { getCounterMenu } from "@/modules/menu/service";
import { listCounterQueue } from "@/modules/orders/service";
import type { CounterMenuData } from "./api";
import { type CounterOrderData, CounterScreen } from "./counter-screen";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// S-02 Counter (FR-QF-02, FR-POS-01..05, Design §6.2): the POS on the left,
// the live queue on the right.
export default function CounterPage() {
  return (
    <Suspense fallback={<div className="h-dvh bg-bg" />}>
      <Counter />
    </Suspense>
  );
}

async function Counter() {
  const session = await sessionFromCookies();
  // Every role may use the Counter (owner, staff, barista).
  if (!session) redirect("/counter/login");
  const [orders, menu] = await Promise.all([
    listCounterQueue(session),
    getCounterMenu(session),
  ]);
  // Same JSON shapes as GET /api/counter/orders and /api/counter/menu.
  const initial = JSON.parse(JSON.stringify(orders)) as CounterOrderData[];
  const initialMenu = JSON.parse(JSON.stringify(menu)) as CounterMenuData;
  return (
    <QueryProvider>
      <CounterScreen
        user={{ name: session.name, sessionId: session.sessionId }}
        initial={initial}
        initialMenu={initialMenu}
        mockPay={getEnv().PAYMENT_PROVIDER === "mock"}
      />
    </QueryProvider>
  );
}
