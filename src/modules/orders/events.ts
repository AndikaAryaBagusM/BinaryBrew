import { z } from "zod";
import { createListenHub } from "@/db/listen-hub";

// Live order changes (Tech §7): LISTEN order_events, fanned out to every open
// stream. Payloads come from repo.notifyOrderEvents.

const orderEvent = z.object({
  orderId: z.uuid(),
  status: z.enum([
    "awaiting_payment",
    "paid",
    "preparing",
    "ready",
    "completed",
    "expired",
    "voided",
  ]),
  queueNumber: z.int().nullable(),
});
export type OrderEvent = z.infer<typeof orderEvent>;

export const subscribeToOrderEvents = createListenHub(
  "order_events",
  orderEvent,
);
