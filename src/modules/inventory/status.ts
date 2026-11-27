// O-05 status chip (Design §6 O-05). One chip per ingredient, stock first:
//   minus    stock below zero (BR-05 allows it; the owner should count)
//   empty    stock exactly zero ("Habis")
//   low      at or below the minimum ("Menipis"), the same rule as v_low_stock
//   no_cost  stock is fine but there is no average cost yet ("Biaya belum ada")
//   ok       "Aman"
// Pure, so the owner screen and tests share it.

export type StockStatus = "minus" | "empty" | "low" | "no_cost" | "ok";

export const STOCK_STATES = ["ok", "low", "empty", "minus"] as const;

export function stockStatus(input: {
  stockMilli: number;
  minMilli: number;
  hasCost: boolean;
}): StockStatus {
  if (input.stockMilli < 0) return "minus";
  if (input.stockMilli === 0) return "empty";
  if (input.stockMilli <= input.minMilli) return "low";
  return input.hasCost ? "ok" : "no_cost";
}

// The summary chips above the table count stock states only, so an
// ingredient without a cost counts as "ok" there.
export function stockState(status: StockStatus): (typeof STOCK_STATES)[number] {
  return status === "no_cost" ? "ok" : status;
}

// Low stock (FR-IV-06, P2-07; A13): active and at or below the minimum, which
// includes Habis and Minus. The dashboard lists the worst first.
const LOW_RANK = { minus: 0, empty: 1, low: 2 } as const;
export type LowStatus = keyof typeof LOW_RANK;

export function lowStatus(
  stockMilli: number,
  minMilli: number,
): LowStatus | null {
  const status = stockStatus({ stockMilli, minMilli, hasCost: true });
  return status === "ok" || status === "no_cost" ? null : status;
}

export function compareLow(
  a: { status: LowStatus; name: string },
  b: { status: LowStatus; name: string },
): number {
  return (
    LOW_RANK[a.status] - LOW_RANK[b.status] ||
    a.name.localeCompare(b.name, "id")
  );
}

// stock.low fires once, when a sale takes stock from above the minimum to at
// or below it; an ingredient that was already low does not fire again.
export function crossedToLow(input: {
  beforeMilli: number;
  afterMilli: number;
  minMilli: number;
}): boolean {
  return (
    lowStatus(input.beforeMilli, input.minMilli) === null &&
    lowStatus(input.afterMilli, input.minMilli) !== null
  );
}
