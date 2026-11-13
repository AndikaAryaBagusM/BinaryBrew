import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { logger } from "@/lib/logger";
import { SHOP_UTC_OFFSET_MINUTES } from "@/lib/time";
import * as repo from "./repo";

// The Apriori job (Tech §10, Schema §5.7) is Python in jobs/apriori/, run
// with its own virtual environment (`npm run reco:setup`). It runs by hand
// (`npm run reco:run`) and from the worker between 03:00 and 04:00.

export const JOB_DIR = path.join("jobs", "apriori");

export function jobPython(root = process.cwd()): string {
  return process.platform === "win32"
    ? path.join(root, JOB_DIR, ".venv", "Scripts", "python.exe")
    : path.join(root, JOB_DIR, ".venv", "bin", "python");
}

// UTF-8 output on every platform (the job prints ≥ and →).
export const jobEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  PYTHONUTF8: "1",
});

export type JobSummary = {
  status:
    "succeeded" | "skipped_insufficient_data" | "failed" | "already_running";
  runId: string | null;
  baskets: number;
  seeded: number;
  rules: number;
  note: string;
};

// Runs the job and resolves with the JSON summary it prints last. Rejects
// when the environment is missing or the job crashed before reporting.
export function runAprioriJob(root = process.cwd()): Promise<JobSummary> {
  const python = jobPython(root);
  if (!existsSync(python)) {
    return Promise.reject(
      new Error("Python environment missing: run `npm run reco:setup`"),
    );
  }
  return new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(JOB_DIR, "run.py"), "--json"], {
      cwd: root,
      env: jobEnv(),
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const last = stdout.trim().split(/\r?\n/).at(-1) ?? "";
      try {
        resolve(JSON.parse(last) as JobSummary);
      } catch {
        reject(
          new Error(
            `Apriori job exited with code ${code}: ${stderr.trim().slice(-500)}`,
          ),
        );
      }
    });
  });
}

const NIGHTLY_HOUR = 3; // Asia/Jakarta
const NIGHTLY_WINDOW_MS = 60 * 60_000;

// Start of the 03:00–04:00 shop-time window `now` is in, or null outside it.
export function nightlyWindow(now: Date): Date | null {
  const offsetMs = SHOP_UTC_OFFSET_MINUTES * 60_000;
  const local = new Date(now.getTime() + offsetMs);
  const start =
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      NIGHTLY_HOUR,
    ) - offsetMs;
  const elapsed = now.getTime() - start;
  return elapsed >= 0 && elapsed < NIGHTLY_WINDOW_MS ? new Date(start) : null;
}

const log = logger.child({ module: "recommendations" });

// One attempt per window in this process, also when it fails (for example
// without the Python environment), so a problem is logged once a night.
let attemptedWindow: number | undefined;

export function resetNightlyRunState() {
  attemptedWindow = undefined;
}

// Worker tick: starts the job when the night window is open and no run
// (nightly or by hand) has started since it opened. Does not wait for the
// job; its outcome is logged.
export async function startNightlyRecommendationRun({
  now = new Date(),
  launch = runAprioriJob,
}: {
  now?: Date;
  launch?: () => Promise<JobSummary>;
} = {}): Promise<boolean> {
  const window = nightlyWindow(now);
  if (!window || attemptedWindow === window.getTime()) return false;
  const lastStart = await repo.selectLatestRunStart();
  if (lastStart && lastStart >= window) return false;

  attemptedWindow = window.getTime();
  launch().then(
    (summary) =>
      log[summary.status === "failed" ? "error" : "info"](
        { event: "reco.nightly_run", ...summary },
        "nightly recommendation run finished",
      ),
    (err: unknown) =>
      log.error(
        { event: "reco.nightly_run_failed", err },
        "nightly recommendation run could not run",
      ),
  );
  return true;
}
