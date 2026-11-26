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
