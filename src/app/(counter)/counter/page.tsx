import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { QueryProvider } from "@/components/query-provider";
import { sessionFromCookies } from "@/modules/auth/server";
import { listCounterQueue } from "@/modules/orders/service";
import { type CounterOrderData, CounterScreen } from "./counter-screen";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// S-02 Counter (FR-QF-02, Design §6.2): the POS on the left arrives in
// P1-11; the queue column is live.
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
  const orders = await listCounterQueue(session);
  // Same JSON shape as GET /api/counter/orders.
  const initial = JSON.parse(JSON.stringify(orders)) as CounterOrderData[];
  return (
    <QueryProvider>
      <CounterScreen
        user={{ name: session.name, sessionId: session.sessionId }}
        initial={initial}
      />
    </QueryProvider>
  );
}
