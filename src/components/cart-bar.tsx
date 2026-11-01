import { ShoppingBag } from "lucide-react";
import Link from "next/link";
import { t } from "@/i18n";
import { formatRupiah } from "@/lib/money";

// Cart bar (Design §5): sticky at the bottom once the cart has items.
export type CartBarProps = { href: string; count: number; total: number };

export function CartBar({ href, count, total }: CartBarProps) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-120 px-4 pt-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <Link
        href={href}
        className="focus-ring flex h-14 items-center gap-3 rounded-card bg-brand px-4 text-on-brand shadow-sheet active:bg-brand-pressed"
      >
        <ShoppingBag aria-hidden="true" size={22} />
        <span className="flex flex-1 flex-col leading-tight">
          <span className="text-caption">
            {t("cart.itemCount", { n: count })}
          </span>
          <span className="text-label">{t("cart.view")}</span>
        </span>
        <span className="text-label">{formatRupiah(total)}</span>
      </Link>
    </div>
  );
}
