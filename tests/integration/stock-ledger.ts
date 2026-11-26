import { getSql } from "@/db/client";

// Schema §4 I7: for every ingredient, stock_qty = Σ stock_movements.qty_delta.
// The docs/05 reconciliation query; an empty result means the invariant holds.
// Shared by every task that moves stock (P2-01 opening, P2-04 sales, …).
export async function stockLedgerMismatches() {
  return getSql()<
    { id: string; name: string; stockQty: string; ledgerQty: string }[]
  >`
    select i.id, i.name, i.stock_qty as "stockQty",
      coalesce(sum(m.qty_delta), 0) as "ledgerQty"
    from ingredients i
    left join stock_movements m on m.ingredient_id = i.id
    group by i.id, i.name, i.stock_qty
    having i.stock_qty <> coalesce(sum(m.qty_delta), 0)`;
}
