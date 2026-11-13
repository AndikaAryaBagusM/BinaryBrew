import { existsSync } from "node:fs";
import { closeSql } from "@/db/client";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { startRepeating } from "@/lib/repeat";
import { runWorkerTick, WORKER_INTERVAL_MS } from "@/modules/worker/service";

// `npm run worker` (Tech §3): runs beside the app and sweeps orders every
// 30 s. Ctrl+C lets the current run finish before exiting.

if (existsSync(".env")) process.loadEnvFile(".env");
getEnv();

const log = logger.child({ process: "worker" });

const loop = startRepeating(
  async () => {
    const { expired, completed, recommendationRunStarted } =
      await runWorkerTick();
    if (expired.length > 0 || completed.length > 0) {
      log.info(
        { expired: expired.length, completed: completed.length },
        "orders swept",
      );
    }
    if (recommendationRunStarted) {
      log.info("nightly recommendation run started");
    }
  },
  WORKER_INTERVAL_MS,
  { onError: (err) => log.error({ err }, "sweep failed") },
);
log.info({ intervalMs: WORKER_INTERVAL_MS }, "worker started");

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, "worker stopping");
  await loop.stop();
  await closeSql();
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
