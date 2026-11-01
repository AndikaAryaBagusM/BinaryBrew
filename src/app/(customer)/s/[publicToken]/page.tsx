import type { Metadata } from "next";
import { Suspense } from "react";
import { EdgeState } from "@/components/edge-state";
import { QrCode } from "@/components/qr-code";
import { QueryProvider } from "@/components/query-provider";
import { t } from "@/i18n";
import { getEnv } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import { getPublicOrder } from "@/modules/orders/service";
import { type OrderData, OrderScreen } from "./order-screen";
import { StatusSkeleton } from "./status-skeleton";

// The link is the order's only key; search engines must not keep it.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// C-05 Payment while unpaid, C-06 Status once paid, on one live page
// (FR-PM-02, FR-QF-03). "Pesanan saya" links here.
export default function StatusPage({ params }: PageProps<"/s/[publicToken]">) {
  return (
    <Suspense fallback={<StatusSkeleton />}>
      {params.then(({ publicToken }) => (
        <Status publicToken={publicToken} />
      ))}
    </Suspense>
  );
}

async function Status({ publicToken }: { publicToken: string }) {
  let order;
  try {
    order = await getPublicOrder(publicToken);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") {
      return <EdgeState variant="orderNotFound" />;
    }
    throw error;
  }
  // Same JSON shape as GET /api/public/orders/{publicToken}.
  const initial = JSON.parse(JSON.stringify(order)) as OrderData;
  const qrString = order.payment?.qrString;
  return (
    <QueryProvider>
      <OrderScreen
        initial={initial}
        qr={
          qrString ? <QrCode value={qrString} label={t("pay.qrLabel")} /> : null
        }
        mockPay={getEnv().PAYMENT_PROVIDER === "mock"}
      />
    </QueryProvider>
  );
}
