import { z } from "zod";
import { MAX_LINES } from "./pricing";

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
});

// Walk-in order at the Counter (FR-POS-01): the same lines as self-order;
// clientSession is the tablet browser's own random id.
export const counterOrderBody = createOrderBody.omit({ qrToken: true });
