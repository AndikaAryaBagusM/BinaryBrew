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
