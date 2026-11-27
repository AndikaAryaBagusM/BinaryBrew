import { z } from "zod";
import { createListenHub } from "@/db/listen-hub";

// Live stock alerts (FR-IV-06, P2-07): LISTEN stock_events, a channel of its
// own so customer, board and counter streams never carry stock data.
// `stock.low` names the ingredients a sale just took from above their
// minimum to at or below it (repo.notifyStockLow, sent inside the paid
// transaction, so delivered only when it commits).

const stockEvent = z.object({
  type: z.literal("stock.low"),
  ingredientIds: z.array(z.uuid()).min(1),
});
export type StockEvent = z.infer<typeof stockEvent>;

export const subscribeToStockEvents = createListenHub(
  "stock_events",
  stockEvent,
);
