import type { Metadata } from "next";
import { Suspense } from "react";
import { CategoryTabs } from "./category-tabs";
import { loadMenu } from "./load-menu";
import { MenuSections } from "./menu-sections";
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
  const result = await loadMenu(qrToken);
  if ("edgeState" in result) return result.edgeState;
  const { menu } = result;

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
      <MenuSections menu={menu} qrToken={qrToken} />
    </div>
  );
}
