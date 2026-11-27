import type postgres from "postgres";
import type { z } from "zod";
import { getSql } from "@/db/client";
import { logger } from "@/lib/logger";

// Live changes (Tech §7): one LISTEN per channel and server process, fanned
// out to every open stream. Payloads are checked; a malformed one is logged
// and dropped. Used by orders/events.ts (order_events) and
// inventory/events.ts (stock_events).

type Hub<T> = {
  listeners: Set<(event: T) => void>;
  listening?: Promise<postgres.ListenMeta>;
};

export function createListenHub<T>(channel: string, schema: z.ZodType<T>) {
  // Per connection pool, so a recreated pool (tests, dev reloads) starts fresh.
  const hubs = new WeakMap<postgres.Sql, Hub<T>>();

  function dispatch(hub: Hub<T>, payload: string) {
    let event: T;
    try {
      event = schema.parse(JSON.parse(payload));
    } catch (error) {
      logger.warn({ err: error, channel }, "ignored a malformed event");
      return;
    }
    for (const listener of hub.listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error({ err: error, channel }, "event listener failed");
      }
    }
  }

  // Resolves once LISTEN is active; the returned function unsubscribes, and
  // the last one out releases the connection.
  return async function subscribe(
    listener: (event: T) => void,
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
      current.listening ??= sql.listen(channel, (payload) =>
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
  };
}
