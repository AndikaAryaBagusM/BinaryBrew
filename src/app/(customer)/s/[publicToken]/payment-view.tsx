"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/button";
import { t } from "@/i18n";
import { formatRupiah } from "@/lib/money";
import { formatCountdown } from "@/lib/order-display";
import type { OrderData } from "./order-screen";

// C-05 Payment (Design §7): large QR, the exact amount, the countdown and the
// instruction. Nothing else to tap but "Kembali ke keranjang" and, with the
// mock provider only, "Simulasi bayar". Paying is detected by the live page.
export function PaymentView({
  order,
  payment,
  qr,
  remainingMs,
  mockPay,
  onChange,
}: {
  order: OrderData;
  payment: NonNullable<OrderData["payment"]>;
  qr: ReactNode;
  remainingMs: number | null;
  mockPay: boolean;
  onChange: () => Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"back" | "pay" | null>(null);
  const [failed, setFailed] = useState(false);

  async function post(url: string): Promise<{ status?: string } | null> {
    setFailed(false);
    try {
      const response = await fetch(url, { method: "POST" });
      if (!response.ok) throw new Error(`${response.status}`);
      return (await response.json()).data;
    } catch {
      setFailed(true);
      return null;
    }
  }

  async function backToCart() {
    setBusy("back");
    const result = await post(`/api/public/orders/${order.publicToken}/cancel`);
    if (result?.status === "expired" && order.menuPath) {
      router.push(`${order.menuPath}/cart`);
      return;
    }
    // Paid meanwhile, or the request failed: show the current state.
    await onChange();
    setBusy(null);
  }

  async function simulatePaid() {
    setBusy("pay");
    await post(`/api/dev/mock-pay/${payment.id}`);
    await onChange();
    setBusy(null);
  }

  return (
    <main className="mx-auto flex w-full max-w-120 flex-1 flex-col items-center gap-4 px-4 pt-6 pb-8 text-center">
      <h1 className="text-h1 text-ink">{t("pay.title")}</h1>
      <div className="flex w-full justify-center rounded-card bg-surface p-3 shadow-card">
        {qr}
      </div>
      <p data-testid="pay-amount" className="text-display-m text-ink">
        {formatRupiah(payment.amount)}
      </p>
      <p role="timer" className="text-label text-price">
        {t("pay.countdown", {
          time: remainingMs === null ? "--:--" : formatCountdown(remainingMs),
        })}
      </p>
      <p className="text-body text-ink-muted">{t("pay.instruction")}</p>
      {failed && (
        <p role="alert" className="text-body font-semibold text-danger">
          {t("error.generic")}
        </p>
      )}

      <div className="mt-auto flex w-full flex-col gap-3 pt-2">
        {mockPay && (
          <div className="flex flex-col gap-2 rounded-card border-2 border-dashed border-border-strong p-3">
            <Button
              variant="secondary"
              loading={busy === "pay"}
              disabled={busy !== null}
              onClick={simulatePaid}
            >
              {t("pay.mockPay")}
            </Button>
            <p className="text-caption text-ink-muted">{t("pay.mockNote")}</p>
          </div>
        )}
        {order.menuPath && (
          <Button
            variant="ghost"
            loading={busy === "back"}
            disabled={busy !== null}
            onClick={backToCart}
          >
            {t("pay.backToCart")}
          </Button>
        )}
      </div>
    </main>
  );
}
