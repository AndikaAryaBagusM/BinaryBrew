import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { type DbExecutor, getDb } from "@/db/client";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { SHOP_UTC_OFFSET_MINUTES } from "@/lib/time";
import { createRateLimiter } from "@/modules/auth/rate-limit";
import { getItemCosts, getSuggestionItems } from "@/modules/menu/service";
import { getSettings } from "@/modules/settings/service";
import * as repo from "./repo";
import { marginShare, scoreSuggestions } from "./scoring";

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

// Suggestions at checkout (FR-CO-05, FR-RC-02..04, Flow §7): C-04 on the
// customer cart and the suggestion row on the Counter. Every suggestion
// returned is logged as "shown"; the client answers with "accepted" or
// "rejected" for that event, and the order links the events it sends.

// Tech §9: per IP and per client session, in process memory.
const limiters = {
  suggest: {
    ip: createRateLimiter({ limit: 30, windowMs: 60_000 }),
    client: createRateLimiter({ limit: 20, windowMs: 60_000 }),
  },
  answer: {
    ip: createRateLimiter({ limit: 60, windowMs: 60_000 }),
    client: createRateLimiter({ limit: 30, windowMs: 60_000 }),
  },
};

export function resetRecommendationRateLimits() {
  for (const kind of Object.values(limiters)) {
    kind.ip.clear();
    kind.client.clear();
  }
}

// Every attempt counts, including refused ones.
export function checkRecommendationRateLimit(
  kind: keyof typeof limiters,
  ip: string,
  clientSession: string,
  now = Date.now(),
) {
  const { ip: byIp, client: byClient } = limiters[kind];
  if (byIp.isLimited(ip, now) || byClient.isLimited(clientSession, now)) {
    throw new AppError("RATE_LIMITED");
  }
  byIp.hit(ip, now);
  byClient.hit(clientSession, now);
}

export type ItemSuggestion = {
  eventId: number;
  menuItemId: string;
  name: string;
  price: number;
  source: "rule" | "promoted";
  // Names of the cart items the rule starts from; empty for "promoted".
  because: string[];
};

export type SuggestInput = {
  clientSession: string;
  itemIds: string[];
  // Events already shown for this cart: a suggestion for the same item and
  // rule reuses its event instead of logging "shown" again (the Counter asks
  // after every cart change).
  shownEventIds?: number[];
  // At most this many, and never more than reco_max_items.
  limit?: number;
};

export async function suggestItems(
  input: SuggestInput,
  { db = getDb() }: { db?: DbExecutor } = {},
): Promise<ItemSuggestion[]> {
  const cart = [...new Set(input.itemIds)];
  const [settings, items, rules] = await Promise.all([
    getSettings(
      ["reco_promote_weight", "reco_margin_weight", "reco_max_items"],
      db,
    ),
    getSuggestionItems(db),
    repo.selectActiveRules(cart, db),
  ]);
  // FR-RC-06: the margin boost uses the current HPP (the O-03/O-09 figure).
  const costs = await getItemCosts(
    [...new Set(rules.map((rule) => rule.consequentId))],
    db,
  );
  const suggestions = scoreSuggestions({
    cart,
    rules,
    items: items.map((item) => {
      const cost = costs.get(item.id);
      return { ...item, marginPct: cost ? marginShare(item.price, cost) : 0 };
    }),
    weights: {
      promoteWeight: settings.reco_promote_weight,
      marginWeight: settings.reco_margin_weight,
      maxItems: Math.min(settings.reco_max_items, input.limit ?? Infinity),
    },
  });
  if (suggestions.length === 0) return [];

  const earlier = await repo.selectOpenShownEvents(
    input.shownEventIds ?? [],
    input.clientSession,
    db,
  );
  const reused = suggestions.map(
    (s) =>
      earlier.find((e) => e.itemId === s.itemId && e.ruleId === s.ruleId)?.id,
  );
  const newIds = await repo.insertEvents(
    suggestions
      .filter((_, index) => reused[index] === undefined)
      .map((s) => ({
        clientSession: input.clientSession,
        ruleId: s.ruleId,
        itemId: s.itemId,
        source: s.source,
        score: s.score === null ? null : s.score.toFixed(4),
        action: "shown" as const,
      })),
    db,
  );

  const byId = new Map(items.map((item) => [item.id, item]));
  return suggestions.map((s, index) => {
    const item = byId.get(s.itemId)!;
    return {
      eventId: reused[index] ?? newIds.shift()!,
      menuItemId: item.id,
      name: item.name,
      price: item.price,
      source: s.source,
      because: s.antecedent.flatMap((id) => byId.get(id)?.name ?? []),
    };
  });
}

// "accepted" or "rejected" for a suggestion this client was shown and has
// not ordered yet. The item, rule, source and score come from the shown
// event, never from the client. The first answer wins: answering again
// returns the event already logged.
export async function answerSuggestion(
  input: {
    clientSession: string;
    eventId: number;
    action: "accepted" | "rejected";
  },
  { db = getDb() }: { db?: DbExecutor } = {},
): Promise<{ eventId: number }> {
  return db.transaction(async (tx) => {
    await repo.lockClientEvents(input.clientSession, tx);
    const [shown] = await repo.selectOpenShownEvents(
      [input.eventId],
      input.clientSession,
      tx,
    );
    if (!shown) throw new AppError("NOT_FOUND");
    const answered = await repo.selectAnswer(shown, input.clientSession, tx);
    if (answered) return { eventId: answered.id };
    const [eventId] = await repo.insertEvents(
      [
        {
          clientSession: input.clientSession,
          ruleId: shown.ruleId,
          itemId: shown.itemId,
          source: shown.source,
          score: shown.score,
          action: input.action,
        },
      ],
      tx,
    );
    return { eventId: eventId! };
  });
}

// Order creation (Schema §5.1): links this client's unlinked events to the
// new order, inside the order's transaction. Ids of other clients, or
// already linked, are ignored.
export function linkSuggestionEvents(
  orderId: string,
  clientSession: string,
  eventIds: readonly number[],
  db: DbExecutor,
): Promise<number> {
  return repo.linkEventsToOrder(
    [...new Set(eventIds)],
    clientSession,
    orderId,
    db,
  );
}
