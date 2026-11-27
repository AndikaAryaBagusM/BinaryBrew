import { type MessageKey, t } from "@/i18n";
import { toCsv } from "@/lib/csv";
import { AppError } from "@/lib/errors";
import { businessDate } from "@/lib/time";
import { requireRole, type SessionUser } from "@/modules/auth/service";
import { getItemCatalog, getItemCosts } from "@/modules/menu/service";
import { getFirstSaleDate, getSalesByItem } from "@/modules/orders/service";
import { getSettings } from "@/modules/settings/service";
import {
  type HppItemRow,
  type HppSummary,
  hppRows,
  hppSummary,
  monthRange,
  reportMonths,
  type SalesRow,
  type SalesTotals,
  salesRows,
} from "./hpp";

// Owner reports (Tech §6 Reports). P2-06: O-09 HPP and margin.

export type HppReport = {
  thresholdPct: number;
  summary: HppSummary;
  // Active items, current recipe and average costs (FR-HP-01, 02).
  items: HppItemRow[];
  // Sales in one month of business dates, from paid, not voided orders and
  // the unit_cogs stored at payment (FR-HP-03, 04).
  period: {
    month: string; // "YYYY-MM"
    months: string[]; // newest first
    rows: SalesRow[];
    totals: SalesTotals;
  };
};

export async function getHppReport(
  actor: SessionUser | null,
  { month, now = new Date() }: { month?: string; now?: Date } = {},
): Promise<HppReport> {
  requireRole(actor, ["owner"]);
  const settings = await getSettings([
    "low_margin_threshold_pct",
    "business_day_cutoff",
  ]);
  const current = businessDate(now, settings.business_day_cutoff).slice(0, 7);
  const months = reportMonths(current, await getFirstSaleDate());
  const chosen = month ?? current;
  if (!months.includes(chosen)) {
    throw new AppError("VALIDATION_FAILED", { details: { fields: ["month"] } });
  }

  const catalog = await getItemCatalog();
  const active = catalog.filter((item) => item.isActive);
  const [costs, sales] = await Promise.all([
    getItemCosts(active.map((item) => item.id)),
    getSalesByItem(monthRange(chosen)),
  ]);
  const items = hppRows(active, costs, settings.low_margin_threshold_pct);
  return {
    thresholdPct: settings.low_margin_threshold_pct,
    summary: hppSummary(items),
    items,
    period: {
      month: chosen,
      months,
      ...salesRows(sales, new Map(catalog.map((item) => [item.id, item.name]))),
    },
  };
}

const NOTE: Record<HppItemRow["status"], MessageKey | null> = {
  complete: null,
  incomplete: "owner.hppIncomplete",
  no_recipe: "owner.hppNoRecipe",
};

// "Unduh CSV": both tables, plain numbers (margin % with a dot, one
// decimal), a UTF-8 byte order mark so spreadsheet apps read the names right.
export async function getHppReportCsv(
  actor: SessionUser | null,
  options: { month?: string; now?: Date } = {},
): Promise<{ filename: string; body: string }> {
  const report = await getHppReport(actor, options);
  const pct = (permille: number | null) =>
    permille === null ? null : (permille / 10).toFixed(1);
  const rows: (string | number | null)[][] = [
    [
      t("owner.colItem"),
      t("owner.colPrice"),
      t("owner.hpp"),
      t("owner.margin"),
      t("owner.colMarginPct"),
      t("owner.colNote"),
    ],
    ...report.items.map((item) => [
      item.name,
      item.price,
      item.hpp,
      item.margin,
      pct(item.marginPermille),
      [
        item.lowMargin ? t("owner.hppLowMargin") : null,
        NOTE[item.status] ? t(NOTE[item.status]!) : null,
      ]
        .filter(Boolean)
        .join("; ") || null,
    ]),
    [],
    [t("owner.hppSalesCsvTitle", { month: report.period.month })],
    [
      t("owner.colItem"),
      t("owner.colSold"),
      t("owner.colRevenue"),
      t("owner.hpp"),
      t("owner.margin"),
      t("owner.colMarginPct"),
      t("owner.colUncosted"),
    ],
    ...[
      ...report.period.rows,
      { ...report.period.totals, name: t("owner.hppSalesTotal") },
    ].map((row) => [
      row.name,
      row.quantity,
      row.revenue,
      row.cogs,
      row.margin,
      pct(row.marginPermille),
      row.uncostedQuantity,
    ]),
  ];
  return {
    filename: `hpp-margin-${report.period.month}.csv`,
    body: `﻿${toCsv(rows)}\r\n`,
  };
}
