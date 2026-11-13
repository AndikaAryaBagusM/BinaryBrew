import {
  completeStaleReadyOrders,
  expireOverdueOrders,
} from "@/modules/orders/service";
import { startNightlyRecommendationRun } from "@/modules/recommendations/service";

// The worker process (Tech §3, P1-09): the order sweeps of Schema §5.3 and
// the nightly recommendation run (Tech §10, P1-15).

export const WORKER_INTERVAL_MS = 30_000;

export async function runWorkerTick({ now = new Date() }: { now?: Date } = {}) {
  const expired = await expireOverdueOrders({ now });
  const completed = await completeStaleReadyOrders({ now });
  const recommendationRunStarted = await startNightlyRecommendationRun({ now });
  return { expired, completed, recommendationRunStarted };
}
