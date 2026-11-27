"use client";

import { PackagePlus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { t } from "@/i18n";
import { formatQuantity, toMilli } from "@/lib/quantity";
import { formatDate } from "@/lib/time";
import { statusChip } from "../ingredients/labels";
import { type LowStockData, useLowStock } from "../owner-queries";
import { PageBody, PageHead, Tag } from "../owner-ui";

// O-02 for now: the "Stok menipis" card (Figma 18:502), every active
// ingredient at or below its minimum, worst first. It shares its query with
// the nav badge, which the owner stream refreshes when a sale makes an
// ingredient low.
export function DashboardScreen({
  today,
  lowStock,
}: {
  today: string;
  lowStock: LowStockData;
}) {
  const { data } = useLowStock(lowStock);
  const items = (data ?? lowStock).items;
  return (
    <PageBody>
      <PageHead
        title={t("owner.navDashboard")}
        subtitle={formatDate(new Date(today))}
      />
      <section
        aria-labelledby="low-stock"
        className="flex max-w-120 flex-col gap-3 rounded-card bg-surface p-5"
      >
        <h2 id="low-stock" className="flex items-center gap-2 text-h2 text-ink">
          <TriangleAlert aria-hidden="true" size={22} />
          {t("owner.lowStock")}
        </h2>
        {items.length === 0 ? (
          <p className="text-owner-body text-ink-muted">
            {t("owner.lowStockNone")}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => {
              const amount = (decimal: string) =>
                `${formatQuantity(toMilli(decimal))} ${item.unit}`;
              const chip = statusChip[item.status];
              return (
                <li key={item.id} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-owner-body font-semibold text-ink">
                      {item.name}
                    </p>
                    <p className="text-caption text-ink-muted tabular-nums">
                      {item.status === "minus"
                        ? t("owner.lowStockCheck", {
                            stock: amount(item.stockQty),
                          })
                        : t("owner.lowStockLine", {
                            stock: amount(item.stockQty),
                            min: amount(item.minStockQty),
                          })}
                    </p>
                  </div>
                  <Tag tone={chip.tone}>{t(chip.label)}</Tag>
                </li>
              );
            })}
          </ul>
        )}
        <Link
          href="/owner/restock"
          className="focus-ring mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-full border-[1.5px] border-border-strong bg-surface px-5 text-label text-brand active:bg-surface-sunken"
        >
          <PackagePlus aria-hidden="true" size={20} />
          {t("owner.lowStockRestock")}
        </Link>
      </section>
    </PageBody>
  );
}
