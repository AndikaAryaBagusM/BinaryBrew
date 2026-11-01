"use client";

import { ArrowLeft, ShoppingBag, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/button";
import { QuantityStepper } from "@/components/quantity-stepper";
import { t } from "@/i18n";
import {
  reconcileCart,
  removeLine,
  setLineQuantity,
  toCartLines,
} from "@/lib/cart";
import { formatRupiah } from "@/lib/money";
import { updateCart, useCartEntries } from "@/lib/use-cart";
import type { PublicMenu } from "@/modules/menu/service";
import { priceOrder } from "@/modules/orders/pricing";
import { MenuSkeleton } from "../menu-skeleton";

// C-03 Cart (Design §7): lines with options, quantity and price, then the
// totals from the pricing service. Lines whose item sold out since they were
// added show "Habis", are left out of the total and block payment.
export function CartView({
  menu,
  qrToken,
}: {
  menu: PublicMenu;
  qrToken: string;
}) {
  const items = menu.categories.flatMap((category) => category.items);
  // Lines list only the choices that differ from the defaults.
  const defaults = new Set(
    items.flatMap((item) =>
      item.modifierGroups.flatMap((group) =>
        group.options.filter((o) => o.isDefault).map((o) => o.id),
      ),
    ),
  );
  const stored = useCartEntries();
  const { entries, soldOut } = reconcileCart(stored ?? [], items);

  // Forget lines whose item or options left the menu.
  useEffect(() => {
    if (stored && entries.length < stored.length) {
      const keep = new Set(entries.map((entry) => entry.lineId));
      updateCart((current) => current.filter((e) => keep.has(e.lineId)));
    }
  }, [entries, stored]);

  const menuHref = `/o/${qrToken}`;
  // The cart is only known after hydration.
  if (stored === undefined) return <MenuSkeleton />;
  if (entries.length === 0) {
    return (
      <main className="mx-auto flex w-full max-w-120 flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-accent-soft text-price">
          <ShoppingBag aria-hidden="true" size={32} />
        </div>
        <h1 className="text-h1 text-ink">{t("cart.empty")}</h1>
        <Link
          href={menuHref}
          className="focus-ring inline-flex h-12 items-center rounded-card bg-brand px-5 text-label text-on-brand active:bg-brand-pressed"
        >
          {t("cart.backToMenu")}
        </Link>
      </main>
    );
  }

  const lines = priceOrder(toCartLines(entries), items, menu.pricing).lines;
  const available = entries.filter((entry) => !soldOut.has(entry.lineId));
  const order =
    available.length > 0
      ? priceOrder(toCartLines(available), items, menu.pricing)
      : undefined;
  const { taxInclusive, taxRateBps } = menu.pricing;

  return (
    <div className="mx-auto flex w-full max-w-120 flex-1 flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-1 bg-bg px-2 py-2">
        <Link
          href={menuHref}
          aria-label={t("menu.title")}
          className="focus-ring flex size-11 items-center justify-center rounded-full text-ink active:bg-surface-sunken"
        >
          <ArrowLeft aria-hidden="true" size={22} />
        </Link>
        <h1 className="text-h1 text-ink">{t("cart.title")}</h1>
      </header>

      <main className="flex flex-col gap-4 px-4 pt-2 pb-28">
        <ul className="flex flex-col gap-3">
          {entries.map((entry, index) => {
            const line = lines[index]!;
            const choices = line.modifiers
              .filter((m) => !defaults.has(m.optionId))
              .map((m) => m.optionName)
              .join(", ");
            const isSoldOut = soldOut.has(entry.lineId);
            return (
              <li
                key={entry.lineId}
                className="flex flex-col gap-3 rounded-card bg-surface p-3 shadow-card"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-label text-ink">{line.name}</h2>
                    {choices && (
                      <p className="text-caption text-ink-muted">{choices}</p>
                    )}
                    {isSoldOut && (
                      <span className="mt-1 inline-block rounded-full bg-surface-sunken px-2 py-0.5 text-caption font-semibold text-ink-muted">
                        {t("menu.soldOut")}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={t("cart.remove", { name: line.name })}
                    onClick={() =>
                      updateCart((current) => removeLine(current, entry.lineId))
                    }
                    className="focus-ring flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted active:bg-surface-sunken"
                  >
                    <Trash2 aria-hidden="true" size={20} />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <QuantityStepper
                    value={entry.quantity}
                    onChange={(quantity) =>
                      updateCart((current) =>
                        setLineQuantity(current, entry.lineId, quantity),
                      )
                    }
                  />
                  <span
                    className={
                      isSoldOut
                        ? "text-label text-ink-muted line-through"
                        : "text-label text-price"
                    }
                  >
                    {formatRupiah(line.lineTotal)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        <dl className="flex flex-col gap-1 rounded-card bg-surface p-3 text-body">
          {order && order.serviceCharge > 0 && (
            <>
              <div className="flex justify-between">
                <dt className="text-ink-muted">{t("cart.subtotal")}</dt>
                <dd className="text-ink">{formatRupiah(order.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">{t("cart.serviceCharge")}</dt>
                <dd className="text-ink">
                  {formatRupiah(order.serviceCharge)}
                </dd>
              </div>
            </>
          )}
          {order && !taxInclusive && order.taxAmount > 0 && (
            <div className="flex justify-between">
              <dt className="text-ink-muted">{t("cart.tax")}</dt>
              <dd className="text-ink">{formatRupiah(order.taxAmount)}</dd>
            </div>
          )}
          <div className="flex justify-between pt-1">
            <dt className="text-label text-ink">{t("cart.total")}</dt>
            <dd data-testid="cart-total" className="text-label text-ink">
              {formatRupiah(order?.total ?? 0)}
            </dd>
          </div>
        </dl>
        {taxInclusive && taxRateBps > 0 && (
          <p className="text-caption text-ink-muted">{t("cart.taxIncluded")}</p>
        )}
        {soldOut.size > 0 && (
          <p role="status" className="text-body font-semibold text-danger">
            {t("cart.soldOutNote")}
          </p>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-120 border-t border-line bg-bg px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {/* Order creation and payment arrive in P1-06. */}
        <Button className="w-full" disabled>
          {t("cart.payQris")}
        </Button>
      </div>
    </div>
  );
}
