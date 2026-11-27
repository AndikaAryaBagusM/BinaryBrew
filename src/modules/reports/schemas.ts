import { z } from "zod";

// O-09 ?month=YYYY-MM; absent means the current month.
export const hppQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
});
