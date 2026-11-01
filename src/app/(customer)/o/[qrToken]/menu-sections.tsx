"use client";

import { useState } from "react";
import { CartBar } from "@/components/cart-bar";
import { MenuItemCard } from "@/components/menu-item-card";
import { t } from "@/i18n";
import {
  addToCart,
  cartQuantity,
  reconcileCart,
  toCartLines,
} from "@/lib/cart";
import { updateCart, useCartEntries } from "@/lib/use-cart";
import type { PublicMenu, PublicMenuItem } from "@/modules/menu/service";
import { type CartLine, priceOrder } from "@/modules/orders/pricing";
import { CustomizeSheet } from "./customize-sheet";

// C-01 item list with working "+" buttons: items without modifier groups go
// straight into the cart; the others open C-02 (Flow §3). Shows the cart bar
// once the cart has items.
export function MenuSections({
  menu,
  qrToken,
}: {
  menu: PublicMenu;
  qrToken: string;
}) {
  const [customizing, setCustomizing] = useState<PublicMenuItem>();
  const [announcement, setAnnouncement] = useState("");

  const items = menu.categories.flatMap((category) => category.items);
  const { entries, soldOut } = reconcileCart(useCartEntries() ?? [], items);
  const available = entries.filter((entry) => !soldOut.has(entry.lineId));
  const count = cartQuantity(available);
  const total =
    count > 0
      ? priceOrder(toCartLines(available), items, menu.pricing).total
      : 0;

  function add(item: PublicMenuItem, line: CartLine) {
    let result = "added";
    updateCart((current) => {
      const next = addToCart(current, line);
      result = next.result;
      return next.entries;
    });
    setAnnouncement(
      result === "full" ? t("cart.full") : t("menu.added", { name: item.name }),
    );
  }

  return (
    <>
      <main
        className={
          count > 0
            ? "flex flex-col gap-6 px-4 pt-4 pb-28"
            : "flex flex-col gap-6 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
        }
      >
        {menu.categories.map((category) => (
          <section
            key={category.id}
            id={`kategori-${category.id}`}
            aria-labelledby={`judul-${category.id}`}
            // scroll-mt clears the sticky header and tabs; the last section
            // is tall enough to scroll under them, so its tab can be current.
            className="scroll-mt-28 last:min-h-[calc(100dvh-7rem)]"
          >
            <h2 id={`judul-${category.id}`} className="mb-3 text-h2 text-ink">
              {category.name}
            </h2>
            {category.items.length === 0 ? (
              <p className="text-body text-ink-muted">
                {t("menu.emptyCategory")}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {category.items.map((item) => (
                  <li key={item.id}>
                    <MenuItemCard
                      item={item}
                      onAdd={() =>
                        item.modifierGroups.length > 0
                          ? setCustomizing(item)
                          : add(item, {
                              menuItemId: item.id,
                              quantity: 1,
                              modifierOptionIds: [],
                            })
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </main>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {customizing && (
        <CustomizeSheet
          key={customizing.id}
          item={customizing}
          onOpenChange={(open) => {
            if (!open) setCustomizing(undefined);
          }}
          onAdd={(line) => {
            add(customizing, line);
            setCustomizing(undefined);
          }}
        />
      )}
      {count > 0 && (
        <CartBar href={`/o/${qrToken}/cart`} count={count} total={total} />
      )}
    </>
  );
}
