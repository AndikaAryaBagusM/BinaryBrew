import { z } from "zod";
import { MAX_LINES } from "@/modules/orders/pricing";
import { clientToken } from "@/modules/orders/schemas";

// Request bodies (Tech §5: Zod at every boundary, unknown fields refused).

export const eventId = z.int().positive().max(Number.MAX_SAFE_INTEGER);
export const eventIds = z.array(eventId).max(20);

export const suggestBody = z.strictObject({
  clientSession: clientToken,
  itemIds: z.array(z.uuid()).min(1).max(MAX_LINES),
  shownEventIds: eventIds.optional(),
});

export const answerBody = z.strictObject({
  clientSession: clientToken,
  eventId,
  action: z.enum(["accepted", "rejected"]),
});
