import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { closeSql, getDb } from "@/db/client";
import { qrTokens } from "@/db/schema";
import { createRandom } from "@/lib/random";
import { defaultLine } from "@/lib/suggestions";
import type { PublicMenu } from "@/modules/menu/service";

// Load script (Tech §11 concurrency, Plan §6 exit criterion): N customers
// spread over M minutes each go through the self-order flow against a
// running app with the mock payment provider:
//   menu → suggestions → (accept half of them) → order → mock pay → status
// Reports errors and latency per request; exits with 1 on any error, a
// duplicate queue number or a p95 above 300 ms.
//
//   npm run load:test -- [--customers 30] [--minutes 10] [--url http://localhost:3000]
//
// Every customer is a phone of its own: own clientSession and own address
// (x-forwarded-for, which the rate limiter keys on). The orders are real and
// paid: reset the database before a demo (`npm run db:reset`).

const P95_TARGET_MS = 300;

type Timing = { step: string; ms: number };
type Outcome =
  | { ok: true; queueNumber: number; timings: Timing[] }
  | { ok: false; error: string; timings: Timing[] };

const token = () => randomBytes(16).toString("base64url");

async function customer(
  index: number,
  base: string,
  qrToken: string,
  seed: number,
): Promise<Outcome> {
  const random = createRandom(seed + index);
  const timings: Timing[] = [];
  const headers = {
    "content-type": "application/json",
    origin: base,
    "x-forwarded-for": `10.77.${Math.floor(index / 250)}.${(index % 250) + 1}`,
  };
  async function call<T>(
    step: string,
    path: string,
    init: { method?: string; body?: unknown; headers?: object } = {},
  ): Promise<T> {
    const started = performance.now();
    const response = await fetch(`${base}${path}`, {
      method: init.method ?? "GET",
      headers: { ...headers, ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const body = await response.json().catch(() => null);
    timings.push({ step, ms: performance.now() - started });
    if (!response.ok) {
      throw new Error(
        `${step}: HTTP ${response.status} ${body?.error?.code ?? ""}`,
      );
    }
    return body.data as T;
  }

  try {
    const clientSession = token();
    const menu = await call<PublicMenu>(
      "menu",
      `/api/public/menu?qr=${qrToken}`,
    );
    const items = menu.categories
      .flatMap((c) => c.items)
      .filter((i) => i.isAvailable && defaultLine(i));
    if (items.length === 0) throw new Error("menu: nothing available");

    // 1 to 3 different items, 1 or 2 of each.
    const picked = new Set<number>();
    const count = random.int(1, Math.min(3, items.length));
    while (picked.size < count) picked.add(random.int(0, items.length - 1));
    const lines = [...picked].map((i) => ({
      ...defaultLine(items[i]!)!,
      quantity: random.int(1, 2),
    }));

    const { suggestions } = await call<{
      suggestions: { eventId: number; menuItemId: string }[];
    }>("suggestions", "/api/public/recommendations", {
      method: "POST",
      body: { clientSession, itemIds: lines.map((l) => l.menuItemId) },
    });
    const eventIds = suggestions.map((s) => s.eventId);
    for (const suggestion of suggestions) {
      const accept = random.chance(0.5);
      const item = items.find((i) => i.id === suggestion.menuItemId);
      const line = item && defaultLine(item);
      const answer = await call<{ eventId: number }>(
        "suggestion answer",
        "/api/public/recommendations/events",
        {
          method: "POST",
          body: {
            clientSession,
            eventId: suggestion.eventId,
            action: accept && line ? "accepted" : "rejected",
          },
        },
      );
      eventIds.push(answer.eventId);
      if (accept && line) lines.push(line);
    }

    const order = await call<{
      publicToken: string;
      payment: { id: string } | null;
    }>("order", "/api/public/orders", {
      method: "POST",
      headers: { "idempotency-key": token() },
      body: {
        qrToken,
        clientSession,
        items: lines,
        recommendationEventIds: eventIds,
      },
    });
    if (!order.payment) throw new Error("order: no payment");

    // The customer takes a moment to pay.
    await new Promise((r) => setTimeout(r, random.int(500, 3000)));
    await call("mock pay", `/api/dev/mock-pay/${order.payment.id}`, {
      method: "POST",
    });

    // The status page: the queue number appears.
    for (let attempt = 0; attempt < 20; attempt++) {
      const status = await call<{ status: string; queueNumber: number | null }>(
        "status",
        `/api/public/orders/${order.publicToken}`,
      );
      if (status.queueNumber !== null) {
        return { ok: true, queueNumber: status.queueNumber, timings };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("status: no queue number after 10 s");
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      timings,
    };
  }
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
}

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const { values } = parseArgs({
    options: {
      customers: { type: "string", default: "30" },
      minutes: { type: "string", default: "10" },
      url: { type: "string", default: "http://localhost:3000" },
      seed: { type: "string", default: "17" },
    },
  });
  const customers = Number(values.customers);
  const minutes = Number(values.minutes);
  const seed = Number(values.seed);
  if (!(customers >= 1 && minutes > 0 && Number.isInteger(seed))) {
    throw new Error("--customers must be ≥ 1 and --minutes > 0");
  }
  const base = values.url.replace(/\/$/, "");

  const qrs = await getDb()
    .select({ token: qrTokens.token })
    .from(qrTokens)
    .where(eq(qrTokens.isActive, true));
  await closeSql();
  if (qrs.length === 0) throw new Error("No active QR codes: run db:seed");
  if (!(await fetch(`${base}/api/health`).catch(() => null))?.ok) {
    throw new Error(`${base} did not answer: start the app first`);
  }

  // Arrivals spread evenly over the window, with jitter.
  const windowMs = minutes * 60_000;
  const random = createRandom(seed);
  const starts = Array.from({ length: customers }, (_, i) =>
    Math.max(0, ((i + random.next()) * windowMs) / customers),
  );
  console.log(
    `${customers} customers over ${minutes} min against ${base} (${qrs.length} QR codes)`,
  );
  const began = Date.now();
  let finished = 0;
  const outcomes = await Promise.all(
    starts.map(
      (start, i) =>
        new Promise<Outcome>((resolve) =>
          setTimeout(async () => {
            const outcome = await customer(
              i,
              base,
              qrs[i % qrs.length]!.token,
              seed,
            );
            finished++;
            console.log(
              `  [${String(finished).padStart(3)}/${customers}] customer ${i + 1}: ${
                outcome.ok
                  ? `#${outcome.queueNumber}`
                  : `ERROR ${outcome.error}`
              }`,
            );
            resolve(outcome);
          }, start),
        ),
    ),
  );

  const timings = outcomes.flatMap((o) => o.timings);
  const errors = outcomes.filter((o) => !o.ok);
  const numbers = outcomes.flatMap((o) => (o.ok ? [o.queueNumber] : []));
  const duplicates = numbers.filter((n, i) => numbers.indexOf(n) !== i);

  console.log(
    `\nDone in ${((Date.now() - began) / 1000).toFixed(0)} s: ${numbers.length} paid, ${errors.length} errors, ${duplicates.length} duplicate queue numbers`,
  );
  console.log(
    `${"request".padEnd(18)} ${"count".padStart(5)} ${"p50".padStart(7)} ${"p95".padStart(7)} ${"max".padStart(7)}`,
  );
  const steps = [...new Set(timings.map((t) => t.step))];
  for (const step of [...steps, "all"]) {
    const ms = timings
      .filter((t) => step === "all" || t.step === step)
      .map((t) => t.ms);
    const fmt = (n: number) => `${n.toFixed(0)} ms`.padStart(7);
    console.log(
      `${step.padEnd(18)} ${String(ms.length).padStart(5)} ${fmt(percentile(ms, 0.5))} ${fmt(percentile(ms, 0.95))} ${fmt(Math.max(...ms))}`,
    );
  }

  const p95 = percentile(
    timings.map((t) => t.ms),
    0.95,
  );
  const failed =
    errors.length > 0 || duplicates.length > 0 || p95 > P95_TARGET_MS;
  if (p95 > P95_TARGET_MS) {
    console.error(`p95 ${p95.toFixed(0)} ms is above ${P95_TARGET_MS} ms.`);
  }
  console.log(failed ? "FAILED" : "PASSED");
  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
