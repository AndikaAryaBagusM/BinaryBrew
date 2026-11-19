import {
  and,
  arrayContained,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  max,
  sql,
} from "drizzle-orm";
import { type DbExecutor, getDb } from "@/db/client";
import {
  associationRuleRuns,
  associationRules,
  recommendationEvents,
} from "@/db/schema";

// SQL only; rules live in service.ts.

export async function selectLatestRunStart(
  db: DbExecutor = getDb(),
): Promise<Date | null> {
  const [row] = await db
    .select({ startedAt: max(associationRuleRuns.startedAt) })
    .from(associationRuleRuns);
  return row?.startedAt ?? null;
}

// Active rules whose antecedent is a subset of the cart (Tech §10 step 1).
export async function selectActiveRules(
  cart: string[],
  db: DbExecutor = getDb(),
) {
  if (cart.length === 0) return [];
  const rows = await db
    .select({
      ruleId: associationRules.id,
      antecedent: associationRules.antecedent,
      consequentId: associationRules.consequentId,
      confidence: associationRules.confidence,
      lift: associationRules.lift,
    })
    .from(associationRules)
    .where(
      and(
        eq(associationRules.isActive, true),
        arrayContained(associationRules.antecedent, cart),
      ),
    );
  return rows.map((row) => ({
    ...row,
    confidence: Number(row.confidence),
    lift: Number(row.lift),
  }));
}

type EventValues = typeof recommendationEvents.$inferInsert;

export async function insertEvents(
  rows: EventValues[],
  db: DbExecutor = getDb(),
): Promise<number[]> {
  if (rows.length === 0) return [];
  const inserted = await db
    .insert(recommendationEvents)
    .values(rows)
    .returning({ id: recommendationEvents.id });
  return inserted.map((row) => row.id);
}

// "shown" events of this client not yet linked to an order.
export function selectOpenShownEvents(
  ids: number[],
  clientSession: string,
  db: DbExecutor = getDb(),
) {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: recommendationEvents.id,
      itemId: recommendationEvents.itemId,
      ruleId: recommendationEvents.ruleId,
      source: recommendationEvents.source,
      score: recommendationEvents.score,
      createdAt: recommendationEvents.createdAt,
    })
    .from(recommendationEvents)
    .where(
      and(
        inArray(recommendationEvents.id, ids),
        eq(recommendationEvents.clientSession, clientSession),
        eq(recommendationEvents.action, "shown"),
        isNull(recommendationEvents.orderId),
      ),
    )
    .orderBy(asc(recommendationEvents.id));
}

// The accepted or rejected event already logged for a shown one, if any.
export async function selectAnswer(
  shown: { itemId: string; createdAt: Date },
  clientSession: string,
  db: DbExecutor = getDb(),
) {
  const [row] = await db
    .select({ id: recommendationEvents.id })
    .from(recommendationEvents)
    .where(
      and(
        eq(recommendationEvents.clientSession, clientSession),
        eq(recommendationEvents.itemId, shown.itemId),
        inArray(recommendationEvents.action, ["accepted", "rejected"]),
        gte(recommendationEvents.createdAt, shown.createdAt),
        isNull(recommendationEvents.orderId),
      ),
    )
    .orderBy(asc(recommendationEvents.id))
    .limit(1);
  return row;
}

// Serialises the answers of one client, so a double tap logs one event.
export async function lockClientEvents(clientSession: string, db: DbExecutor) {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`reco:${clientSession}`}, 0))`,
  );
}

// Sets order_id once, when the order is created; the only change ever made
// to an event.
export async function linkEventsToOrder(
  ids: number[],
  clientSession: string,
  orderId: string,
  db: DbExecutor,
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(recommendationEvents)
    .set({ orderId })
    .where(
      and(
        inArray(recommendationEvents.id, ids),
        eq(recommendationEvents.clientSession, clientSession),
        isNull(recommendationEvents.orderId),
      ),
    )
    .returning({ id: recommendationEvents.id });
  return rows.length;
}
