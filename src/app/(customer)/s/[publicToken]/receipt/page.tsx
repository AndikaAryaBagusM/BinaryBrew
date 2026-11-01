import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { EdgeState } from "@/components/edge-state";
import { t, type MessageKey } from "@/i18n";
import { isAppError } from "@/lib/errors";
import { formatRupiah } from "@/lib/money";
import { formatQueueNumber } from "@/lib/order-display";
import { formatDate, formatTime } from "@/lib/time";
import { getPublicOrder, type PublicOrder } from "@/modules/orders/service";
import { getSettings } from "@/modules/settings/service";
import { StatusSkeleton } from "../status-skeleton";
import { PrintButton } from "./print-button";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const methodLabel: Record<
  NonNullable<PublicOrder["payment"]>["method"],
  MessageKey
> = {
  qris_dynamic: "receipt.method.qris",
  qris_static_manual: "receipt.method.manual",
  cash: "receipt.method.cash",
};

// C-07 Receipt (Design §7), print-friendly. Only for paid orders; anything
// else goes back to the live status page.
export default function ReceiptPage({
  params,
}: PageProps<"/s/[publicToken]/receipt">) {
  return (
    <Suspense fallback={<StatusSkeleton />}>
      {params.then(({ publicToken }) => (
        <Receipt publicToken={publicToken} />
      ))}
    </Suspense>
  );
}

async function Receipt({ publicToken }: { publicToken: string }) {
  let order: PublicOrder;
  try {
    order = await getPublicOrder(publicToken);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") {
      return <EdgeState variant="orderNotFound" />;
    }
    throw error;
  }
  if (order.queueNumber === null || order.paidAt === null) {
    redirect(`/s/${publicToken}`);
  }
  const { shop_name: shopName } = await getSettings(["shop_name"]);
  const row = "flex justify-between gap-4";

  return (
    <main className="mx-auto flex w-full max-w-120 flex-1 flex-col gap-4 px-4 pt-6 pb-8 print:max-w-none print:p-0">
      <header className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-h1 text-ink">{shopName}</h1>
        <p className="text-caption text-ink-muted">
          {formatDate(order.paidAt)} {formatTime(order.paidAt)}
        </p>
        <p className="text-label text-ink">
          {t("receipt.orderNumber")} {formatQueueNumber(order.queueNumber)}
        </p>
      </header>

      <ul className="flex flex-col gap-2 border-y border-dashed border-line py-3">
        {order.items.map((item, index) => (
          <li key={index} className={row}>
            <span className="text-body text-ink">
              {item.quantity}× {item.name}
              {item.options.length > 0 && (
                <span className="block text-caption text-ink-muted">
                  {item.options.join(", ")}
                </span>
              )}
            </span>
            <span className="text-body text-ink">
              {formatRupiah(item.lineTotal)}
            </span>
          </li>
        ))}
      </ul>

      <dl className="flex flex-col gap-1 text-body">
        <div className={row}>
          <dt className="text-ink-muted">{t("cart.subtotal")}</dt>
          <dd className="text-ink">{formatRupiah(order.subtotal)}</dd>
        </div>
        {order.serviceCharge > 0 && (
          <div className={row}>
            <dt className="text-ink-muted">{t("cart.serviceCharge")}</dt>
            <dd className="text-ink">{formatRupiah(order.serviceCharge)}</dd>
          </div>
        )}
        {!order.taxInclusive && order.taxAmount > 0 && (
          <div className={row}>
            <dt className="text-ink-muted">{t("cart.tax")}</dt>
            <dd className="text-ink">{formatRupiah(order.taxAmount)}</dd>
          </div>
        )}
        <div className={`${row} pt-1`}>
          <dt className="text-label text-ink">{t("cart.total")}</dt>
          <dd className="text-label text-ink">{formatRupiah(order.total)}</dd>
        </div>
        {order.taxInclusive && order.taxAmount > 0 && (
          <p className="text-caption text-ink-muted">
            {t("receipt.taxIncluded", {
              amount: formatRupiah(order.taxAmount),
            })}
          </p>
        )}
        {order.payment && (
          <div className={`${row} pt-2`}>
            <dt className="text-ink-muted">{t("receipt.paymentMethod")}</dt>
            <dd className="text-ink">{t(methodLabel[order.payment.method])}</dd>
          </div>
        )}
      </dl>

      <p className="text-center text-label text-ink">{t("receipt.thanks")}</p>

      <div className="flex flex-col gap-2 print:hidden">
        <PrintButton />
        <Link
          href={`/s/${publicToken}`}
          className="focus-ring flex min-h-11 items-center justify-center rounded-card text-label text-brand underline underline-offset-4"
        >
          {t("receipt.backToStatus")}
        </Link>
      </div>
    </main>
  );
}
