import type { Metadata } from "next";
import { Suspense } from "react";
import { loadMenu } from "../load-menu";
import { MenuSkeleton } from "../menu-skeleton";
import { CartView } from "./cart-view";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// C-03 Cart (FR-CO-04). The cart itself is in the browser; the menu supplies
// current prices, availability and rates so the total matches the server.
export default function CartPage({ params }: PageProps<"/o/[qrToken]/cart">) {
  return (
    <Suspense fallback={<MenuSkeleton />}>
      {params.then(({ qrToken }) => (
        <Cart qrToken={qrToken} />
      ))}
    </Suspense>
  );
}

async function Cart({ qrToken }: { qrToken: string }) {
  const result = await loadMenu(qrToken);
  if ("edgeState" in result) return result.edgeState;
  return <CartView menu={result.menu} qrToken={qrToken} />;
}
