import { z } from "zod";
import { MAX_LINES } from "./pricing";
import { voidReasons } from "./void-reasons";

// Request bodies (Tech §5: Zod at every boundary, unknown fields refused).
// Quantities and option rules are checked by the pricing service, which
// gives the precise reason.

// Random per-browser id and per-request key: URL-safe, 16 to 64 characters.
export const clientToken = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

// Counter status buttons (FR-QF-02): the next step only; the service checks
// which one that is.
export const statusChangeBody = z.strictObject({
  status: z.enum(["preparing", "ready", "completed"]),
});

// S-06 void (P3-01): a reason from the list; "other" needs the note.
// elevationId comes from POST /api/auth/elevate (scope void_order).
export const voidOrderBody = z
  .strictObject({
    reason: z.enum(voidReasons),
    note: z.string().trim().max(200).optional(),
    elevationId: z.uuid(),
  })
  .refine((body) => body.reason !== "other" || Boolean(body.note), {
    path: ["note"],
  });

// O-12 list: one business day (default today) and an optional search.
export const ownerOrdersQuery = z.strictObject({
  date: z.iso.date().optional(),
  q: z.string().trim().max(64).optional(),
});

export const createOrderBody = z.strictObject({
  qrToken: z.string().min(1).max(64),
  clientSession: clientToken,
  items: z
    .array(
      z.strictObject({
        menuItemId: z.uuid(),
        quantity: z.int(),
        modifierOptionIds: z.array(z.uuid()).max(50),
      }),
    )
    .max(MAX_LINES),
  // Suggestion events of this checkout (C-04, Counter row), linked to the
  // order (FR-RC-04).
  recommendationEventIds: z
    .array(z.int().positive().max(Number.MAX_SAFE_INTEGER))
    .max(20)
    .optional(),
});

// Walk-in order at the Counter (FR-POS-01): the same lines as self-order;
// clientSession is the tablet browser's own random id.
export const counterOrderBody = createOrderBody.omit({ qrToken: true });
