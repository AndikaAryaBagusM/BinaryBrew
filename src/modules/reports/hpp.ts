import { averagePermille, marginPermille } from "@/lib/money";
import type { ItemCost, ItemCostStatus } from "@/modules/menu/cost";
import type { ItemSales } from "@/modules/orders/service";

// O-09 HPP and margin report (FR-HP-01, 02, 04), built from plain inputs so
// the arithmetic is unit-tested without a database. Money is whole rupiah;
// margin percentages are tenths of a percent (money.marginPermille).

export type HppItemRow = {
  id: string;
  name: string;
  price: number;
  status: ItemCostStatus;
  hpp: number | null;
  margin: number | null;
  marginPermille: number | null;
  // FR-HP-02: margin % below the owner's threshold (settings).
  lowMargin: boolean;
};

export type HppSummary = {
  averagePermille: number | null; // over items with a recipe and a price
  withRecipe: number;
  lowMargin: number;
  incomplete: number;
};

export type SalesRow = {
  menuItemId: string;
  name: string;
  quantity: number;
  revenue: number;
  cogs: number;
  uncostedQuantity: number;
  // Null while any portion has no unit_cogs: the margin would be overstated.
  margin: number | null;
  marginPermille: number | null;
};

export type SalesTotals = Omit<SalesRow, "menuItemId" | "name">;

// Current HPP and margin of each item, lowest margin first; items without a
// recipe last; ties by name.
export function hppRows(
  items: readonly { id: string; name: string; price: number }[],
  costs: ReadonlyMap<string, ItemCost>,
  thresholdPct: number,
): HppItemRow[] {
  const rows = items.map((item) => {
    const cost = costs.get(item.id) ?? { status: "no_recipe", hpp: null };
    const permille =
      cost.hpp === null ? null : marginPermille(item.price, cost.hpp);
    return {
      id: item.id,
      name: item.name,
      price: item.price,
      status: cost.status,
      hpp: cost.hpp,
      margin: cost.hpp === null ? null : item.price - cost.hpp,
      marginPermille: permille,
      lowMargin: permille !== null && permille < thresholdPct * 10,
    };
  });
  return rows.sort((a, b) => {
    if (a.marginPermille === null || b.marginPermille === null) {
      if (a.marginPermille !== b.marginPermille) {
        return a.marginPermille === null ? 1 : -1;
      }
    } else if (a.marginPermille !== b.marginPermille) {
      return a.marginPermille - b.marginPermille;
    }
    return a.name.localeCompare(b.name);
  });
}

export function hppSummary(rows: readonly HppItemRow[]): HppSummary {
  const permilles = rows.flatMap((row) =>
    row.marginPermille === null ? [] : [row.marginPermille],
  );
  return {
    averagePermille: averagePermille(permilles),
    withRecipe: rows.filter((row) => row.status !== "no_recipe").length,
    lowMargin: rows.filter((row) => row.lowMargin).length,
    incomplete: rows.filter((row) => row.status === "incomplete").length,
  };
}

type SalesFigures = Pick<
  SalesRow,
  "quantity" | "revenue" | "cogs" | "uncostedQuantity"
>;

function withMargin<T extends SalesFigures>(
  row: T,
): T & Pick<SalesRow, "margin" | "marginPermille"> {
  const known = row.uncostedQuantity === 0;
  return {
    ...row,
    margin: known ? row.revenue - row.cogs : null,
    marginPermille: known ? marginPermille(row.revenue, row.cogs) : null,
  };
}

// Sales in the period per item, most sold first; names are the current ones.
export function salesRows(
  sales: readonly ItemSales[],
  names: ReadonlyMap<string, string>,
): { rows: SalesRow[]; totals: SalesTotals } {
  const rows = sales
    .map((sale) =>
      withMargin({ ...sale, name: names.get(sale.menuItemId) ?? "—" }),
    )
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
  const sum = (key: "quantity" | "revenue" | "cogs" | "uncostedQuantity") =>
    rows.reduce((total, row) => total + row[key], 0);
  const totals = withMargin({
    quantity: sum("quantity"),
    revenue: sum("revenue"),
    cogs: sum("cogs"),
    uncostedQuantity: sum("uncostedQuantity"),
  });
  return { rows, totals };
}

// "2026-10" → its first and last calendar day.
export function monthRange(month: string): { from: string; to: string } {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, "0")}`,
  };
}

// Months the report offers, newest first: the current one back to the month
// of the first sale (a "YYYY-MM-DD" business date), at most `limit`.
export function reportMonths(
  current: string,
  first: string | null,
  limit = 24,
): string[] {
  const months: string[] = [];
  let [year, mon] = current.split("-").map(Number) as [number, number];
  const floor = (first ?? current).slice(0, 7); // "YYYY-MM"
  for (let i = 0; i < limit; i++) {
    const month = `${year}-${String(mon).padStart(2, "0")}`;
    // The current month is always offered, even before any sale.
    if (i > 0 && month < floor) break;
    months.push(month);
    mon -= 1;
    if (mon === 0) {
      mon = 12;
      year -= 1;
    }
  }
  return months;
}
