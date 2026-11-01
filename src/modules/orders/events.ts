import type postgres from "postgres";
import { z } from "zod";
import { getSql } from "@/db/client";
import { logger } from "@/lib/logger";

// Live order changes (Tech §7): one LISTEN order_events per server process,
// fanned out to every open stream. Payloads come from repo.notifyOrderEvents.

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
type Listener = (event: OrderEvent) => void;

type Hub = {
  listeners: Set<Listener>;
  listening?: Promise<postgres.ListenMeta>;
};

// Per connection pool, so a recreated pool (tests, dev reloads) starts fresh.
const hubs = new WeakMap<postgres.Sql, Hub>();

function dispatch(hub: Hub, payload: string) {
  let event: OrderEvent;
  try {
    event = orderEvent.parse(JSON.parse(payload));
  } catch (error) {
    logger.warn({ err: error }, "ignored a malformed order event");
    return;
  }
  for (const listener of hub.listeners) {
    try {
      listener(event);
    } catch (error) {
      logger.error({ err: error }, "order event listener failed");
    }
  }
}

// Resolves once LISTEN is active; the returned function unsubscribes, and the
// last one out releases the connection.
export async function subscribeToOrderEvents(
  listener: Listener,
): Promise<() => Promise<void>> {
  const sql = getSql();
  let hub = hubs.get(sql);
  if (!hub) {
    hub = { listeners: new Set() };
    hubs.set(sql, hub);
  }
  const current = hub;
  current.listeners.add(listener);
  try {
    current.listening ??= sql.listen("order_events", (payload) =>
      dispatch(current, payload),
    );
    await current.listening;
  } catch (error) {
    current.listeners.delete(listener);
    current.listening = undefined;
    throw error;
  }

  let done = false;
  return async () => {
    if (done) return;
    done = true;
    current.listeners.delete(listener);
    if (current.listeners.size === 0 && current.listening) {
      const listening = current.listening;
      current.listening = undefined;
      await (await listening).unlisten();
    }
  };
}
