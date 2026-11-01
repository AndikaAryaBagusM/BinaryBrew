import {
  completeStaleReadyOrders,
  expireOverdueOrders,
} from "@/modules/orders/service";

// The worker process (Tech §3, P1-09): the order sweeps of Schema §5.3. The
// nightly recommendation run joins in P1-15.

export const WORKER_INTERVAL_MS = 30_000;

export async function runWorkerTick({ now = new Date() }: { now?: Date } = {}) {
  const expired = await expireOverdueOrders({ now });
  const completed = await completeStaleReadyOrders({ now });
  return { expired, completed };
}
