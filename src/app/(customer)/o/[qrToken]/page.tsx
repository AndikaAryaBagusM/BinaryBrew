import type { Metadata } from "next";
import { Suspense } from "react";
import { EdgeState } from "@/components/edge-state";
import { MenuItemCard } from "@/components/menu-item-card";
import { t } from "@/i18n";
import { isAppError } from "@/lib/errors";
import { getPublicMenu, type PublicMenu } from "@/modules/menu/service";
import { CategoryTabs } from "./category-tabs";
import { MenuSkeleton } from "./menu-skeleton";
import { MyOrders } from "./my-orders";

// QR links are per table and rotate; search engines must not keep them.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// C-01 Menu (FR-CO-01, FR-CO-02) with the C-08 invalid QR and closed states.
// The token is runtime data, so it is read inside Suspense (Cache Components).
export default function MenuPage({ params }: PageProps<"/o/[qrToken]">) {
  return (
    <Suspense fallback={<MenuSkeleton />}>
      {params.then(({ qrToken }) => (
        <Menu qrToken={qrToken} />
      ))}
    </Suspense>
  );
}

async function Menu({ qrToken }: { qrToken: string }) {
  let menu: PublicMenu;
  try {
    menu = await getPublicMenu(qrToken);
  } catch (error) {
    if (isAppError(error) && error.code === "QR_INVALID") {
      return <EdgeState variant="qrInvalid" />;
    }
    if (isAppError(error) && error.code === "ORDERING_CLOSED") {
      return <EdgeState variant="closed" />;
    }
    throw error;
  }
  return <MenuView menu={menu} />;
}

function MenuView({ menu }: { menu: PublicMenu }) {
  return (
    <div className="mx-auto flex w-full max-w-120 flex-1 flex-col">
      <div className="sticky top-0 z-10 bg-bg">
        <header className="flex items-center gap-2 px-4 pt-3 pb-1">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-h1 text-ink">{menu.shopName}</h1>
            <p className="truncate text-caption text-ink-muted">{menu.table}</p>
          </div>
          <MyOrders />
        </header>
        <CategoryTabs
          categories={menu.categories.map(({ id, name }) => ({ id, name }))}
        />
      </div>
      <main className="flex flex-col gap-6 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
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
                    <MenuItemCard item={item} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </main>
    </div>
  );
}
