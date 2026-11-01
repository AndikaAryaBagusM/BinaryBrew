"use client";

import { Ban, QrCode, SlidersHorizontal } from "lucide-react";
import { type Ref, useImperativeHandle, useRef, useState } from "react";
import { Button } from "@/components/button";
import { QuantityStepper } from "@/components/quantity-stepper";
import { t } from "@/i18n";
import {
  addToCart,
  type CartEntry,
  reconcileCart,
  removeLine,
  setLineQuantity,
  toCartLines,
} from "@/lib/cart";
import { getClientSession, newClientToken } from "@/lib/client-session";
import { cn } from "@/lib/cn";
import { formatRupiah } from "@/lib/money";
import { type CartLine, priceOrder } from "@/modules/orders/pricing";
import {
  api,
  type CounterMenuData,
  type CounterMenuItemData,
  soldOutNames,
} from "./api";
import type { Charge } from "./charge-dialog";
import {
  clearCounterCart,
  updateCounterCart,
  useCounterCart,
} from "./counter-cart";

// S-02 left (Figma 14:4, Design §6.2, Flow §5.3): category buttons, a
// 3-column item grid and the walk-in cart. A tap adds the item, or opens S-03
// when it has options. "Bayar" creates the order on the server, which prices
// it, and opens S-04 with its QRIS charge. The handle takes lines from S-03
// and lets S-04 ask for a new charge of the same cart after one expired.
export type PosPanelHandle = {
  add: (line: CartLine) => void;
  charge: () => void;
};

export function PosPanel({
  ref,
  menu,
  onCustomize,
  onCharge,
  onMenuStale,
  onSignedOut,
}: {
  ref?: Ref<PosPanelHandle>;
  menu: CounterMenuData;
  onCustomize: (item: CounterMenuItemData) => void;
  onCharge: (charge: Charge) => void;
  onMenuStale: () => void;
  onSignedOut: () => void;
}) {
  const [category, setCategory] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // The Idempotency-Key of the attempt in flight: kept until the server
  // answers, so a retry after a network error cannot create a second order.
  const attempt = useRef<string | null>(null);

  const items = menu.categories.flatMap((c) => c.items);
  const stored = useCounterCart();
  const { entries, soldOut } = reconcileCart(stored, items);
  const available = entries.filter((entry) => !soldOut.has(entry.lineId));
  const order =
    available.length > 0
      ? priceOrder(toCartLines(available), items, menu.pricing)
      : null;
  const shown =
    category === null
      ? items
      : (menu.categories.find((c) => c.id === category)?.items ?? []);

  function tap(item: CounterMenuItemData) {
    setMessage(null);
    if (item.modifierGroups.length > 0) onCustomize(item);
    else add({ menuItemId: item.id, quantity: 1, modifierOptionIds: [] });
  }

  function add(line: CartLine) {
    let full = false;
    updateCounterCart((current) => {
      const result = addToCart(current, line);
      full = result.result === "full";
      return result.entries;
    });
    if (full) setMessage(t("cart.full"));
  }

  async function charge() {
    if (!order || soldOut.size > 0) return;
    setSending(true);
    setMessage(null);
    attempt.current ??= newClientToken();
    const result = await api<Omit<Charge, "summary">>("/api/counter/orders", {
      method: "POST",
      headers: { "idempotency-key": attempt.current },
      body: {
        clientSession: getClientSession(localStorage),
        items: toCartLines(available),
      },
    });
    // A server error may still have created the order: keep the key.
    if (result.status > 0 && result.status < 500) attempt.current = null;
    setSending(false);
    if (result.ok) {
      onCharge({ ...result.data, summary: summary(available, items) });
      return;
    }
    if (result.status === 401) return onSignedOut();
    if (result.error.code === "ITEM_SOLD_OUT") {
      setMessage(
        t("counter.chargeSoldOut", {
          items: soldOutNames(result.error).join(", "),
        }),
      );
      onMenuStale();
      return;
    }
    setMessage(result.error.message);
  }

  useImperativeHandle(ref, () => ({ add, charge: () => void charge() }));

  return (
    <main className="flex w-[60%] min-w-0 flex-col gap-4 p-6">
      <div
        role="group"
        aria-label={t("counter.categoriesLabel")}
        className="flex shrink-0 gap-2 overflow-x-auto"
      >
        {[{ id: null, name: t("counter.categoryAll") }, ...menu.categories].map(
          (each) => (
            <button
              key={each.id ?? "all"}
              type="button"
              aria-pressed={category === each.id}
              onClick={() => setCategory(each.id)}
              className={cn(
                "focus-ring h-14 shrink-0 cursor-pointer rounded-full border px-5.5 text-counter-body whitespace-nowrap transition-colors duration-100",
                category === each.id
                  ? "border-brand bg-brand text-on-brand"
                  : "border-line bg-surface text-ink active:bg-accent-soft",
              )}
            >
              {each.name}
            </button>
          ),
        )}
      </div>

      <ul className="grid min-h-0 flex-1 auto-rows-[128px] grid-cols-3 gap-3 overflow-y-auto">
        {shown.map((item) => (
          <li key={item.id}>
            <MenuTile item={item} onTap={() => tap(item)} />
          </li>
        ))}
      </ul>

      <section
        aria-labelledby="cart-title"
        className="flex shrink-0 flex-col gap-3 rounded-[16px] bg-surface p-4 shadow-card"
      >
        <div className="flex items-center">
          <h2 id="cart-title" className="flex-1 text-counter-title text-ink">
            {t("counter.posTitle")}
          </h2>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => {
                clearCounterCart();
                setMessage(null);
              }}
              className="focus-ring cursor-pointer rounded-control px-1 text-label text-brand underline"
            >
              {t("counter.clearCart")}
            </button>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="text-body text-ink-muted">{t("counter.cartEmpty")}</p>
        ) : (
          <ul className="flex max-h-46 flex-col gap-3 overflow-y-auto">
            {entries.map((entry) => (
              <CartRow
                key={entry.lineId}
                entry={entry}
                item={items.find((i) => i.id === entry.menuItemId)!}
                soldOut={soldOut.has(entry.lineId)}
              />
            ))}
          </ul>
        )}
        {message && (
          <p role="alert" className="text-body font-semibold text-danger">
            {message}
          </p>
        )}
        {soldOut.size > 0 && (
          <p className="text-body text-danger">{t("cart.soldOutNote")}</p>
        )}
        <Button
          size="counter"
          className="w-full"
          icon={<QrCode aria-hidden="true" />}
          disabled={!order || soldOut.size > 0}
          loading={sending}
          onClick={() => void charge()}
        >
          {order
            ? t("counter.charge", { price: formatRupiah(order.total) })
            : t("counter.charge", { price: formatRupiah(0) })}
        </Button>
      </section>
    </main>
  );
}

function MenuTile({
  item,
  onTap,
}: {
  item: CounterMenuItemData;
  onTap: () => void;
}) {
  const soldOut = !item.isAvailable;
  return (
    <button
      type="button"
      disabled={soldOut}
      onClick={onTap}
      className={cn(
        "focus-ring flex size-full cursor-pointer flex-col items-start gap-2 rounded-card border border-line p-3.5 text-left transition-colors duration-100 disabled:cursor-not-allowed",
        soldOut ? "bg-surface-sunken" : "bg-surface active:bg-accent-soft",
      )}
    >
      <span className="flex w-full items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-10 items-center justify-center rounded-control text-counter-title",
            soldOut ? "bg-line text-ink-muted" : "bg-accent-soft text-brand",
          )}
        >
          {item.name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="flex-1" />
        {soldOut ? (
          <span className="flex items-center gap-1 rounded-full bg-status-expired-bg px-2 py-1 text-caption font-medium text-status-expired-fg">
            <Ban aria-hidden="true" size={14} />
            {t("menu.soldOut")}
          </span>
        ) : (
          item.modifierGroups.length > 0 && (
            <span className="flex items-center gap-1 text-caption text-ink-muted">
              <SlidersHorizontal aria-hidden="true" size={16} />
              {t("counter.hasOptions")}
            </span>
          )
        )}
      </span>
      <span
        className={cn(
          "line-clamp-2 text-counter-body",
          soldOut ? "text-ink-muted" : "text-ink",
        )}
      >
        {item.name}
      </span>
      <span
        className={cn(
          "mt-auto text-label",
          soldOut ? "text-ink-muted" : "text-price",
        )}
      >
        {formatRupiah(item.price)}
      </span>
    </button>
  );
}

function CartRow({
  entry,
  item,
  soldOut,
}: {
  entry: CartEntry;
  item: CounterMenuItemData;
  soldOut: boolean;
}) {
  const chosen = new Set(entry.modifierOptionIds);
  const options = item.modifierGroups
    .flatMap((group) => group.options)
    .filter((option) => chosen.has(option.id));
  const unit =
    item.price + options.reduce((sum, option) => sum + option.priceDelta, 0);
  return (
    <li className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-counter-body text-ink">
          {item.name}
          {soldOut && (
            <span className="ml-2 text-caption font-medium text-danger">
              {t("menu.soldOut")}
            </span>
          )}
        </p>
        {options.length > 0 && (
          <p className="truncate text-caption text-ink-muted">
            {options.map((option) => option.name).join(" · ")}
          </p>
        )}
      </div>
      <QuantityStepper
        size="counter"
        min={0}
        value={entry.quantity}
        label={item.name}
        decreaseLabel={
          entry.quantity === 1
            ? t("counter.removeLine", { name: item.name })
            : undefined
        }
        onChange={(quantity) =>
          updateCounterCart((current) =>
            quantity === 0
              ? removeLine(current, entry.lineId)
              : setLineQuantity(current, entry.lineId, quantity),
          )
        }
      />
      <p className="w-28 shrink-0 text-right text-counter-body text-price tabular-nums">
        {formatRupiah(Math.max(0, unit) * entry.quantity)}
      </p>
    </li>
  );
}

// "2× Americano · 1× Brownie" for S-04 and S-05.
function summary(
  entries: readonly CartEntry[],
  items: readonly CounterMenuItemData[],
): string {
  return entries
    .map((entry) => {
      const item = items.find((i) => i.id === entry.menuItemId);
      return `${entry.quantity}× ${item?.name ?? ""}`;
    })
    .join(" · ");
}
