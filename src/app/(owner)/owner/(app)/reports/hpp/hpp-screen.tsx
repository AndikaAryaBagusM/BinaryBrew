"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, Info, Percent, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { SelectField } from "@/components/field";
import { t } from "@/i18n";
import { api, type Json } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatPermille, formatRupiah, formatSignedRupiah } from "@/lib/money";
import { formatMonth } from "@/lib/time";
import type { HppReport } from "@/modules/reports/service";
import {
  PageBody,
  Notice,
  PageHead,
  TableCard,
  Tag,
  tdClass,
  thClass,
  useSignedOutGuard,
} from "../../owner-ui";

export type HppReportData = Json<HppReport>;
type ItemRow = HppReportData["items"][number];

const REPORT_QUERY = (month: string) => ["owner", "hpp", month] as const;

const numberCell = `${tdClass} text-right whitespace-nowrap tabular-nums`;
const numberHead = `${thClass} text-right`;

// O-09 (Figma 20:1649): current HPP and margin per active item, lowest
// margin first, with the low-margin flag (owner threshold, O-14), and what
// sold in the chosen month at the HPP stored when it was paid. Read only;
// the server computes every figure.
export function HppScreen({ initial }: { initial: HppReportData }) {
  const signedOut = useSignedOutGuard();
  const [month, setMonth] = useState(initial.period.month);
  // One query per month; the page's server render seeds the current one,
  // and the previous month stays on screen while the next one loads.
  const { data, isFetching, isError } = useQuery({
    queryKey: REPORT_QUERY(month),
    queryFn: async () => {
      const result = await api<HppReportData>(
        `/api/owner/reports/hpp?month=${encodeURIComponent(month)}`,
      );
      if (signedOut(result)) return null;
      if (!result.ok) throw new Error(result.error.message);
      return result.data;
    },
    initialData: month === initial.period.month ? initial : undefined,
    placeholderData: keepPreviousData,
  });
  const shown = data ?? initial;

  const { summary } = shown;
  return (
    <PageBody>
      <PageHead title={t("owner.hppTitle")} subtitle={t("owner.hppSubtitle")}>
        <SelectField
          label={t("owner.hppPeriod")}
          value={month}
          className="w-56"
          options={shown.period.months.map((value) => ({
            value,
            label: formatMonth(value),
          }))}
          onChange={(event) => setMonth(event.target.value)}
        />
        <a
          href={`/api/owner/reports/hpp/csv?month=${encodeURIComponent(month)}`}
          download
          className="focus-ring inline-flex h-12 items-center gap-2 self-end rounded-full border-[1.5px] border-border-strong bg-surface px-5 text-label text-brand active:bg-surface-sunken"
        >
          <Download aria-hidden="true" size={20} />
          {t("owner.hppDownload")}
        </a>
      </PageHead>
      {isError && <Notice tone="danger">{t("error.generic")}</Notice>}

      <ul
        aria-label={t("owner.hppTitle")}
        className="grid gap-4 sm:grid-cols-3"
      >
        <SummaryCard
          icon={<Percent aria-hidden="true" size={18} />}
          label={t("owner.hppAverage")}
          value={
            summary.averagePermille === null
              ? "—"
              : formatPermille(summary.averagePermille)
          }
          note={t("owner.hppAverageNote", { n: summary.withRecipe })}
        />
        <SummaryCard
          icon={<TriangleAlert aria-hidden="true" size={18} />}
          label={t("owner.hppLowCard")}
          value={t("owner.hppCount", { n: summary.lowMargin })}
          note={t("owner.hppLowNote", {
            pct: String(shown.thresholdPct).replace(".", ","),
          })}
        />
        <SummaryCard
          icon={<Info aria-hidden="true" size={18} />}
          label={t("owner.hppIncompleteCard")}
          value={t("owner.hppCount", { n: summary.incomplete })}
          note={t("owner.hppIncompleteNote")}
        />
      </ul>

      <TableCard label={t("owner.hppCurrentTitle")} minWidth="min-w-220">
        <thead>
          <tr>
            <th scope="col" className={thClass}>
              {t("owner.colItem")}
            </th>
            <th scope="col" className={`${numberHead} w-28`}>
              {t("owner.colPrice")}
            </th>
            <th scope="col" className={`${numberHead} w-28`}>
              {t("owner.hpp")}
            </th>
            <th scope="col" className={`${numberHead} w-28`}>
              {t("owner.margin")}
            </th>
            <th scope="col" className={`${numberHead} w-24`}>
              {t("owner.colMarginPct")}
            </th>
            <th scope="col" className={`${thClass} w-56`}>
              {t("owner.colNote")}
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.items.length === 0 && (
            <tr>
              <td colSpan={6} className={`${tdClass} text-ink-muted`}>
                {t("owner.hppEmpty")}
              </td>
            </tr>
          )}
          {shown.items.map((item) => (
            <tr
              key={item.id}
              className={cn(item.lowMargin && "bg-danger-soft")}
            >
              <th scope="row" className={`${tdClass} font-semibold`}>
                {item.name}
              </th>
              <td className={numberCell}>{formatRupiah(item.price)}</td>
              <td className={numberCell}>
                {item.hpp === null ? "—" : formatRupiah(item.hpp)}
              </td>
              <td className={numberCell}>
                {item.margin === null ? "—" : formatSignedRupiah(item.margin)}
              </td>
              <td
                className={cn(
                  numberCell,
                  item.lowMargin && "font-semibold text-danger",
                )}
              >
                {item.marginPermille === null
                  ? "—"
                  : formatPermille(item.marginPermille)}
              </td>
              <td className={tdClass}>
                <ItemNote item={item} />
              </td>
            </tr>
          ))}
        </tbody>
      </TableCard>

      <section
        aria-labelledby="hpp-sales"
        aria-busy={isFetching || undefined}
        className="flex flex-col gap-3"
      >
        <div>
          <h2 id="hpp-sales" className="text-h2 text-ink">
            {t("owner.hppSalesTitle")} · {formatMonth(shown.period.month)}
          </h2>
          <p className="text-owner-body text-ink-muted">
            {t("owner.hppSalesHelp")}
          </p>
        </div>
        {shown.period.rows.length === 0 ? (
          <p className="rounded-card bg-surface px-4 py-4 text-owner-body text-ink-muted">
            {t("owner.hppSalesEmpty")}
          </p>
        ) : (
          <TableCard
            label={`${t("owner.hppSalesTitle")} · ${formatMonth(shown.period.month)}`}
            minWidth="min-w-220"
          >
            <thead>
              <tr>
                <th scope="col" className={thClass}>
                  {t("owner.colItem")}
                </th>
                <th scope="col" className={`${numberHead} w-24`}>
                  {t("owner.colSold")}
                </th>
                <th scope="col" className={`${numberHead} w-32`}>
                  {t("owner.colRevenue")}
                </th>
                <th scope="col" className={`${numberHead} w-32`}>
                  {t("owner.hpp")}
                </th>
                <th scope="col" className={`${numberHead} w-32`}>
                  {t("owner.margin")}
                </th>
                <th scope="col" className={`${numberHead} w-24`}>
                  {t("owner.colMarginPct")}
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ...shown.period.rows.map((row) => ({ ...row, total: false })),
                {
                  ...shown.period.totals,
                  menuItemId: "total",
                  name: t("owner.hppSalesTotal"),
                  total: true,
                },
              ].map((row) => (
                <tr
                  key={row.menuItemId}
                  className={cn(row.total && "bg-surface-sunken font-semibold")}
                >
                  <th
                    scope="row"
                    className={cn(tdClass, !row.total && "font-semibold")}
                  >
                    {row.name}
                    {row.uncostedQuantity > 0 && (
                      <span className="block text-caption font-normal text-ink-muted">
                        {t("owner.hppUncostedNote", {
                          n: row.uncostedQuantity,
                        })}
                      </span>
                    )}
                  </th>
                  <td className={numberCell}>{row.quantity}</td>
                  <td className={numberCell}>{formatRupiah(row.revenue)}</td>
                  <td className={numberCell}>{formatRupiah(row.cogs)}</td>
                  <td className={numberCell}>
                    {row.margin === null ? "—" : formatSignedRupiah(row.margin)}
                  </td>
                  <td className={numberCell}>
                    {row.marginPermille === null
                      ? "—"
                      : formatPermille(row.marginPermille)}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableCard>
        )}
      </section>
    </PageBody>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  note,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <li className="flex flex-col gap-1 rounded-card bg-surface px-5 py-4">
      <p className="flex items-center gap-2 text-caption font-medium text-ink">
        {icon}
        {label}
      </p>
      <p className="text-h1 text-ink tabular-nums">{value}</p>
      <p className="text-caption text-ink-muted">{note}</p>
    </li>
  );
}

function ItemNote({ item }: { item: ItemRow }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {item.lowMargin && (
        <Tag tone="alert">
          <TriangleAlert aria-hidden="true" size={14} className="mr-1" />
          {t("owner.hppLowMargin")}
        </Tag>
      )}
      {item.status === "incomplete" && (
        <Tag tone="info">
          <Info aria-hidden="true" size={14} className="mr-1" />
          {t("owner.hppIncomplete")}
        </Tag>
      )}
      {item.status === "no_recipe" && (
        <Tag tone="expired">{t("owner.hppNoRecipe")}</Tag>
      )}
    </span>
  );
}
