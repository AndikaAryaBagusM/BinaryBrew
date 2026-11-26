import { z } from "zod";

// S-08 (FR-POS-04): mark an item sold out or available again.
export const soldOutBody = z.strictObject({ soldOut: z.boolean() });

// O-03 (FR-OW-02, FR-RC-05). Prices are whole rupiah (Schema §1).
const name = z.string().trim().min(1).max(60);
const price = z.int().min(0).max(10_000_000);
const description = z
  .string()
  .trim()
  .max(200)
  .transform((value) => (value === "" ? null : value))
  .nullable();

export const menuItemBody = z.strictObject({
  categoryId: z.uuid(),
  name,
  description: description.default(null),
  price,
  isActive: z.boolean().default(true),
  isPromoted: z.boolean().default(false),
});

// Any subset of the fields; at least one.
export const menuItemPatch = z
  .strictObject({
    categoryId: z.uuid(),
    name,
    description,
    price,
    isActive: z.boolean(),
    isPromoted: z.boolean(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "empty patch");

export const categoryBody = z.strictObject({ name });

export const categoryPatch = z
  .strictObject({ name, isActive: z.boolean() })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "empty patch");

// ---- O-06 and O-04 (P2-02, FR-IV-02, FR-OW-03) ------------------------------

// recipe_items.qty and modifier_option_ingredients.qty_delta are
// numeric(12,3): up to 9 whole digits and 3 decimals, in the ingredient's
// base unit (g, ml, pcs).
const recipeQty = z
  .string()
  .trim()
  .regex(/^\d{1,9}(?:\.\d{1,3})?$/)
  .refine((value) => Number(value) > 0, "must be > 0");
const qtyDelta = z
  .string()
  .trim()
  .regex(/^-?\d{1,9}(?:\.\d{1,3})?$/)
  .refine((value) => Number(value) !== 0, "must not be 0");

const uniqueBy =
  <T>(key: (row: T) => string) =>
  (rows: readonly T[]) =>
    new Set(rows.map(key)).size === rows.length;

export const MAX_RECIPE_LINES = 30;

export const recipeBody = z.strictObject({
  lines: z
    .array(z.strictObject({ ingredientId: z.uuid(), qty: recipeQty }))
    .max(MAX_RECIPE_LINES)
    .refine(
      uniqueBy((line: { ingredientId: string }) => line.ingredientId),
      "duplicate ingredient",
    ),
});

export const itemGroupsBody = z.strictObject({
  groupIds: z
    .array(z.uuid())
    .max(10)
    .refine(
      uniqueBy((id: string) => id),
      "duplicate group",
    ),
});

const selectCount = z.int().min(0).max(10);

export const modifierGroupBody = z
  .strictObject({
    name,
    minSelect: selectCount.default(0),
    maxSelect: selectCount.min(1).default(1),
    isActive: z.boolean().default(true),
  })
  .refine((group) => group.minSelect <= group.maxSelect, {
    message: "minSelect > maxSelect",
    path: ["minSelect"],
  });

export const modifierGroupPatch = z
  .strictObject({
    name,
    minSelect: selectCount,
    maxSelect: selectCount.min(1),
    isActive: z.boolean(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "empty patch");

const ingredientDeltas = z
  .array(z.strictObject({ ingredientId: z.uuid(), qtyDelta }))
  .max(10)
  .refine(
    uniqueBy((delta: { ingredientId: string }) => delta.ingredientId),
    "duplicate ingredient",
  );

const priceDelta = z.int().min(-10_000_000).max(10_000_000);

export const modifierOptionBody = z.strictObject({
  name,
  priceDelta: priceDelta.default(0),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  ingredientDeltas: ingredientDeltas.default([]),
});

export const modifierOptionPatch = z
  .strictObject({
    name,
    priceDelta,
    isDefault: z.boolean(),
    isActive: z.boolean(),
    ingredientDeltas,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, "empty patch");
