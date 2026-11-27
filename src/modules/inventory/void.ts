import { fromMilli, toMilli } from "@/lib/quantity";

// Void (P3-01, FR-IV-09, BR-08, Schema §5.4). The sale already took the
// ingredients out of stock. Every void puts them back with a void_return; an
// order that was being prepared or was ready also logs the same amounts as
// waste, so stock stays where the sale left it and the loss shows in the
// ledger. Pure: amounts in, movements out.

export type OrderMovement = {
  ingredientId: string;
  type: "void_return" | "waste";
  qtyDelta: string;
};

export function voidMovements(
  deductions: readonly { ingredientId: string; qtyDelta: string }[],
  prepared: boolean,
): OrderMovement[] {
  const movements: OrderMovement[] = [];
  for (const { ingredientId, qtyDelta } of deductions) {
    const taken = -toMilli(qtyDelta);
    if (taken <= 0) continue;
    movements.push({
      ingredientId,
      type: "void_return",
      qtyDelta: fromMilli(taken),
    });
    if (prepared) {
      movements.push({
        ingredientId,
        type: "waste",
        qtyDelta: fromMilli(-taken),
      });
    }
  }
  return movements;
}
