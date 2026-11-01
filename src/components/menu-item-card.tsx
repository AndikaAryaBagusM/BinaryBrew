import { Plus } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";
import { formatRupiah } from "@/lib/money";
import type { PublicMenuItem } from "@/modules/menu/service";

// Menu card (Design §5, C-01): name, short description, price and a "+"
// button. Sold-out items stay visible, greyed, with "Habis" and a disabled
// button. Without a photo, an accent tile shows the first letter (§4.5).
export type MenuItemCardProps = {
  item: PublicMenuItem;
  onAdd?: () => void;
};

export function MenuItemCard({ item, onAdd }: MenuItemCardProps) {
  const soldOut = !item.isAvailable;
  return (
    <article className="flex gap-3 rounded-card bg-surface p-3 shadow-card">
      <div className={cn("shrink-0", soldOut && "opacity-50 grayscale")}>
        {item.imageUrl ? (
          // Owner-uploaded WebP, ≤ 100 KB (Design §4.5).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt={item.name}
            width={88}
            height={66}
            loading="lazy"
            className="h-[66px] w-[88px] rounded-control object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-[66px] w-[88px] items-center justify-center rounded-control bg-accent-soft text-h1 text-price"
          >
            {item.name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="text-label text-ink">{item.name}</h3>
        {item.description && (
          <p className="mt-0.5 line-clamp-2 text-body text-ink-muted">
            {item.description}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span
            className={cn(
              "text-label",
              soldOut ? "text-ink-muted line-through" : "text-price",
            )}
          >
            {formatRupiah(item.price)}
          </span>
          <div className="flex items-center gap-2">
            {soldOut && (
              <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-caption font-semibold text-ink-muted">
                {t("menu.soldOut")}
              </span>
            )}
            <button
              type="button"
              aria-label={t("menu.addItem", { name: item.name })}
              disabled={soldOut}
              onClick={onAdd}
              className="focus-ring flex size-11 cursor-pointer items-center justify-center rounded-full bg-brand text-on-brand transition-colors duration-100 active:bg-brand-pressed disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus aria-hidden="true" size={22} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
