import { Suspense } from "react";
import { listOwnerOrders } from "@/modules/orders/service";
import { listRefunds } from "@/modules/payments/service";
import { asJson, ownerSessionOrLogin } from "../../session";
import {
  type OrdersData,
  OrdersScreen,
  type RefundsData,
} from "./orders-screen";

// O-12 Pesanan & refund (P3-01, FR-OW-08, FR-PM-08; Figma 22:1930).
export default function OwnerOrdersPage() {
  return (
    <Suspense fallback={null}>
      <Orders />
    </Suspense>
  );
}

async function Orders() {
  const session = await ownerSessionOrLogin();
  // Same JSON shapes as GET /api/owner/orders (today) and /api/owner/refunds.
  const [orders, refunds] = await Promise.all([
    listOwnerOrders(session, {}),
    listRefunds(session),
  ]);
  return (
    <OrdersScreen
      initialOrders={asJson<OrdersData>(orders)}
      initialRefunds={asJson<RefundsData>({ refunds })}
    />
  );
}
