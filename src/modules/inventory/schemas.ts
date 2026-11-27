import { z } from "zod";
import { QUANTITY_PATTERN } from "@/lib/quantity";

// O-05 (FR-IV-01). Quantities are decimal strings in the ingredient's base
// unit with up to 3 decimals (Schema §1); money is whole rupiah.

const name = z.string().trim().min(1).max(60);
const quantity = z.string().trim().regex(QUANTITY_PATTERN);
const kind = z.enum(["raw", "resale"]);
const unit = z.enum(["g", "ml", "pcs"]);

// Opening stock and what was paid for it come together (docs/05 §3.5), so
// the average cost never starts at zero for stock that is there.
const opening = z.strictObject({
  quantity: quantity.refine((value) => Number(value) > 0, "must be > 0"),
  totalCost: z.int().min(1).max(100_000_000),
});

export const ingredientBody = z.strictObject({
  name,
  kind: kind.default("raw"),
  unit,
  minStockQty: quantity.default("0"),
  isActive: z.boolean().default(true),
  opening: opening.nullable().default(null),
});

// Any subset; at least one. Stock and cost never change here: they follow
// restocks (P2-05), sales (P2-04) and stock counts (P3).
export const ingredientPatch = z
  .strictObject({
    name,
    kind,
    unit,
    minStockQty: quantity,
    isActive: z.boolean(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "empty patch");

const note = z
  .string()
  .trim()
  .max(200)
  .transform((value) => (value === "" ? null : value))
  .nullable();

export const supplierBody = z.strictObject({
  name,
  note: note.default(null),
  isActive: z.boolean().default(true),
});

export const supplierPatch = z
  .strictObject({ name, note, isActive: z.boolean() })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "empty patch");

// S-09 and O-07 (FR-IV-05): one or more purchases saved together. The total
// is what was paid for the whole quantity; it may be 0 (a free delivery).
// The purchase date defaults to today and may not be in the future (checked
// by the service, in the shop's time zone).
export const MAX_RESTOCK_LINES = 20;
export const MAX_RESTOCK_TOTAL = 100_000_000;

export const restockBody = z.strictObject({
  lines: z
    .array(
      z.strictObject({
        ingredientId: z.uuid(),
        quantity: quantity.refine((value) => Number(value) > 0, "must be > 0"),
        totalCost: z.int().min(0).max(MAX_RESTOCK_TOTAL),
        supplierId: z.uuid().nullable().default(null),
        purchasedOn: z.iso.date().nullable().default(null),
      }),
    )
    .min(1)
    .max(MAX_RESTOCK_LINES),
});
