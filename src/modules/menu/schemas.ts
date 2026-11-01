import { z } from "zod";

// S-08 (FR-POS-04): mark an item sold out or available again.
export const soldOutBody = z.strictObject({ soldOut: z.boolean() });
