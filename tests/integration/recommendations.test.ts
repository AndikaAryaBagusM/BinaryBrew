import { eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as counterRecoPost } from "@/app/api/counter/recommendations/route";
import { POST as ordersPost } from "@/app/api/public/orders/route";
import { POST as recoPost } from "@/app/api/public/recommendations/route";
import { POST as eventsPost } from "@/app/api/public/recommendations/events/route";
import { closeSql, type DbExecutor, getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { randomToken } from "@/lib/ids";
import { SESSION_COOKIE } from "@/modules/auth/cookies";
import { pinLogin, resetAuthRateLimits } from "@/modules/auth/service";
import { resetOrderRateLimits } from "@/modules/orders/service";
import {
  answerSuggestion,
  resetRecommendationRateLimits,
  suggestItems,
} from "@/modules/recommendations/service";
import { createDevice, createUser, unique } from "./auth-fixtures";
import { createCatalog } from "./menu-fixtures";

// P1-16 (FR-CO-05, FR-RC-02..04, Flow §7): suggestions from the active rules,
// logged as shown; answers copy the shown event; the order links its events.
//
// Integration files share one database: rules here only start from this
// file's items, and assertions look at this file's client sessions.

afterAll(() => closeSql());

let catalog: Awaited<ReturnType<typeof createCatalog>>;
let brownie: typeof schema.menuItems.$inferSelect;
const rules: Record<string, string> = {};

beforeAll(async () => {
  catalog = await createCatalog();
  const db = getDb();
  const [created] = await db
    .insert(schema.menuItems)
    .values({
      categoryId: catalog.categories.food.id,
      name: unique("Brownie"),
      price: 16000,
    })
    .returning();
  brownie = created!;

  const { americano, latte, croissant, soldOut, inactive } = catalog.items;
  const [active, old] = await db
    .insert(schema.associationRuleRuns)
    .values([
      {
        status: "succeeded",
        minSupport: "0.02",
        minConfidence: "0.15",
        minLift: "1.05",
      },
      {
        status: "succeeded",
        minSupport: "0.02",
        minConfidence: "0.15",
        minLift: "1.05",
      },
    ])
    .returning();
  const rule = (
    name: string,
    runId: string,
    antecedent: string[],
    consequentId: string,
    confidence: string,
    isActive = true,
  ) => ({
    name,
    values: {
      runId,
      antecedent,
      consequentId,
      support: "0.05",
      confidence,
      lift: "2.0",
      isActive,
    },
  });
  const all = [
    rule("croissant", active!.id, [americano.id], croissant.id, "0.35"),
    rule("latte", active!.id, [americano.id], latte.id, "0.2"),
    rule("pair", active!.id, [americano.id, latte.id], brownie!.id, "0.5"),
    rule("soldOut", active!.id, [americano.id], soldOut.id, "0.9"),
    rule("inactiveItem", active!.id, [americano.id], inactive.id, "0.95"),
    rule("oldRun", old!.id, [americano.id], brownie!.id, "0.99", false),
  ];
  const inserted = await db
    .insert(schema.associationRules)
    .values(all.map((r) => r.values))
    .returning({ id: schema.associationRules.id });
  all.forEach((r, index) => (rules[r.name] = inserted[index]!.id));
});

beforeEach(() => {
  resetRecommendationRateLimits();
  resetOrderRateLimits();
  resetAuthRateLimits();
});

const session = () => randomToken(16);
const eventsOf = (clientSession: string) =>
  getDb()
    .select()
    .from(schema.recommendationEvents)
    .where(eq(schema.recommendationEvents.clientSession, clientSession))
    .orderBy(schema.recommendationEvents.id);

// Runs fn in a transaction that is always rolled back.
async function inRollback(fn: (tx: DbExecutor) => Promise<void>) {
  const rollback = new Error("rollback");
  await expect(
    getDb().transaction(async (tx) => {
      await fn(tx);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}

describe("suggestItems (Tech §10)", () => {
  it("suggests the best rules for the cart and logs them as shown", async () => {
    const clientSession = session();
    const { americano, croissant, latte } = catalog.items;
    const suggestions = await suggestItems({
      clientSession,
      itemIds: [americano.id],
    });
    expect(suggestions).toEqual([
      {
        eventId: expect.any(Number),
        menuItemId: croissant.id,
        name: croissant.name,
        price: 18000,
        source: "rule",
        because: [americano.name],
      },
      {
        eventId: expect.any(Number),
        menuItemId: latte.id,
        name: latte.name,
        price: 25000,
        source: "rule",
        because: [americano.name],
      },
    ]);
    const events = await eventsOf(clientSession);
    expect(events).toMatchObject([
      {
        id: suggestions[0]!.eventId,
        itemId: croissant.id,
        ruleId: rules.croissant,
        source: "rule",
        score: "0.3500",
        action: "shown",
        orderId: null,
      },
      {
        id: suggestions[1]!.eventId,
        itemId: latte.id,
        ruleId: rules.latte,
        score: "0.2000",
      },
    ]);
  });

  it("matches a two-item antecedent", async () => {
    const { americano, latte, croissant } = catalog.items;
    const suggestions = await suggestItems({
      clientSession: session(),
      itemIds: [latte.id, americano.id],
    });
    expect(suggestions.map((s) => [s.menuItemId, s.because])).toEqual([
      [brownie.id, [americano.name, latte.name]],
      [croissant.id, [americano.name]],
    ]);
  });

  it("never suggests items in the cart, sold out or inactive", async () => {
    const { americano, croissant, latte } = catalog.items;
    const suggestions = await suggestItems({
      clientSession: session(),
      itemIds: [americano.id, croissant.id],
    });
    // The sold-out (0.9) and inactive (0.95) items and the old run's rule
    // (0.99) score higher but are not offered.
    expect(suggestions.map((s) => s.menuItemId)).toEqual([latte.id]);
  });

  it("falls back to one promoted item when no rule matches", async () => {
    await inRollback(async (tx) => {
      await tx.update(schema.menuItems).set({ isPromoted: false });
      await tx
        .update(schema.menuItems)
        .set({ isPromoted: true })
        .where(eq(schema.menuItems.id, brownie.id));
      const clientSession = session();
      const suggestions = await suggestItems(
        { clientSession, itemIds: [catalog.items.croissant.id] },
        { db: tx },
      );
      expect(suggestions).toEqual([
        expect.objectContaining({
          menuItemId: brownie.id,
          source: "promoted",
          because: [],
        }),
      ]);
      const [event] = await tx
        .select()
        .from(schema.recommendationEvents)
        .where(eq(schema.recommendationEvents.clientSession, clientSession));
      expect(event).toMatchObject({
        source: "promoted",
        ruleId: null,
        score: null,
      });

      // Nothing promoted: no suggestion at all.
      await tx.update(schema.menuItems).set({ isPromoted: false });
      expect(
        await suggestItems(
          { clientSession, itemIds: [catalog.items.croissant.id] },
          { db: tx },
        ),
      ).toEqual([]);
    });
  });

  it("honours the limit and reuses events already shown", async () => {
    const clientSession = session();
    const itemIds = [catalog.items.americano.id];
    const [first] = await suggestItems({ clientSession, itemIds, limit: 1 });
    expect(first!.menuItemId).toBe(catalog.items.croissant.id);
    const [again] = await suggestItems({
      clientSession,
      itemIds,
      limit: 1,
      shownEventIds: [first!.eventId],
    });
    expect(again!.eventId).toBe(first!.eventId);
    expect(await eventsOf(clientSession)).toHaveLength(1);

    // Another client's event is not reused.
    const other = session();
    const [theirs] = await suggestItems({
      clientSession: other,
      itemIds,
      limit: 1,
      shownEventIds: [first!.eventId],
    });
    expect(theirs!.eventId).not.toBe(first!.eventId);
  });
});

describe("answerSuggestion (FR-RC-04)", () => {
  it("logs accepted or rejected from the shown event; the first answer wins", async () => {
    const clientSession = session();
    const [croissant, latte] = await suggestItems({
      clientSession,
      itemIds: [catalog.items.americano.id],
    });
    const accepted = await answerSuggestion({
      clientSession,
      eventId: croissant!.eventId,
      action: "accepted",
    });
    const rejected = await answerSuggestion({
      clientSession,
      eventId: latte!.eventId,
      action: "rejected",
    });
    const twice = await answerSuggestion({
      clientSession,
      eventId: croissant!.eventId,
      action: "rejected",
    });
    expect(twice).toEqual(accepted);

    const events = await eventsOf(clientSession);
    expect(
      events.map((e) => [e.id, e.action, e.itemId, e.ruleId, e.score]),
    ).toEqual([
      [
        croissant!.eventId,
        "shown",
        catalog.items.croissant.id,
        rules.croissant,
        "0.3500",
      ],
      [latte!.eventId, "shown", catalog.items.latte.id, rules.latte, "0.2000"],
      [
        accepted.eventId,
        "accepted",
        catalog.items.croissant.id,
        rules.croissant,
        "0.3500",
      ],
      [
        rejected.eventId,
        "rejected",
        catalog.items.latte.id,
        rules.latte,
        "0.2000",
      ],
    ]);
  });

  it("refuses events of another client, unknown ids and answers", async () => {
    const clientSession = session();
    const [shown] = await suggestItems({
      clientSession,
      itemIds: [catalog.items.americano.id],
    });
    await expect(
      answerSuggestion({
        clientSession: session(),
        eventId: shown!.eventId,
        action: "accepted",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      answerSuggestion({ clientSession, eventId: 2 ** 52, action: "accepted" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { eventId } = await answerSuggestion({
      clientSession,
      eventId: shown!.eventId,
      action: "accepted",
    });
    // An answer is not a shown event.
    await expect(
      answerSuggestion({ clientSession, eventId, action: "rejected" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// Route helpers -----------------------------------------------------------

const BASE = "http://localhost:3000";
function request(
  path: string,
  body: unknown,
  options: { session?: string; ip?: string } = {},
) {
  const headers = new Headers({
    host: new URL(BASE).host,
    origin: BASE,
    "content-type": "application/json",
    "x-forwarded-for": options.ip ?? unique("ip"),
  });
  if (options.session) {
    headers.set("cookie", `${SESSION_COOKIE}=${options.session}`);
  }
  return new NextRequest(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/public/recommendations and /events", () => {
  it("returns suggestions, stores answers and links them to the order", async () => {
    const clientSession = session();
    const { americano } = catalog.items;
    const response = await recoPost(
      request("/api/public/recommendations", {
        clientSession,
        itemIds: [americano.id],
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { suggestions } = (await response.json()).data;
    expect(suggestions).toHaveLength(2);

    const answer = await eventsPost(
      request("/api/public/recommendations/events", {
        clientSession,
        eventId: suggestions[0].eventId,
        action: "accepted",
      }),
    );
    expect(answer.status).toBe(201);
    const { eventId: acceptedId } = (await answer.json()).data;

    // Someone else's event in the list is left alone.
    const other = session();
    const [foreign] = await suggestItems({
      clientSession: other,
      itemIds: [americano.id],
    });

    const order = await ordersPost(
      new NextRequest(`${BASE}/api/public/orders`, {
        method: "POST",
        headers: {
          host: new URL(BASE).host,
          origin: BASE,
          "content-type": "application/json",
          "idempotency-key": randomToken(16),
          "x-forwarded-for": unique("ip"),
        },
        body: JSON.stringify({
          qrToken: catalog.qr.token,
          clientSession,
          items: [americano.id, catalog.items.croissant.id].map((id) => ({
            menuItemId: id,
            quantity: 1,
            modifierOptionIds: [],
          })),
          recommendationEventIds: [
            suggestions[0].eventId,
            suggestions[1].eventId,
            acceptedId,
            foreign!.eventId,
          ],
        }),
      }),
    );
    expect(order.status).toBe(201);
    const { publicToken } = (await order.json()).data;
    const [row] = await getDb()
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(eq(schema.orders.publicToken, publicToken));

    const linked = await getDb()
      .select({
        id: schema.recommendationEvents.id,
        orderId: schema.recommendationEvents.orderId,
      })
      .from(schema.recommendationEvents)
      .where(
        inArray(schema.recommendationEvents.id, [
          suggestions[0].eventId,
          suggestions[1].eventId,
          acceptedId,
          foreign!.eventId,
        ]),
      )
      .orderBy(schema.recommendationEvents.id);
    expect(linked.map((e) => e.orderId)).toEqual([
      row!.id,
      row!.id,
      row!.id,
      null,
    ]);
    // Linked events can no longer be answered.
    await expect(
      answerSuggestion({
        clientSession,
        eventId: suggestions[1].eventId,
        action: "rejected",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses bad bodies and other origins", async () => {
    const bad = await recoPost(
      request("/api/public/recommendations", {
        clientSession: session(),
        itemIds: [],
      }),
    );
    expect(bad.status).toBe(400);
    const unknownEvent = await eventsPost(
      request("/api/public/recommendations/events", {
        clientSession: session(),
        eventId: 1,
        action: "shown",
      }),
    );
    expect(unknownEvent.status).toBe(400);
  });

  it("rate limits per client session", async () => {
    const clientSession = session();
    const body = { clientSession, itemIds: [catalog.items.croissant.id] };
    for (let i = 0; i < 20; i++) {
      const ok = await recoPost(request("/api/public/recommendations", body));
      expect(ok.status).toBe(200);
    }
    const limited = await recoPost(
      request("/api/public/recommendations", body),
    );
    expect(limited.status).toBe(429);
  });
});

describe("POST /api/counter/recommendations (S-02)", () => {
  it("needs a staff session and returns the top suggestion only", async () => {
    const body = {
      clientSession: session(),
      itemIds: [catalog.items.americano.id],
    };
    const anonymous = await counterRecoPost(
      request("/api/counter/recommendations", body),
    );
    expect(anonymous.status).toBe(401);

    const user = await createUser({ role: "staff", pin: "135790" });
    const device = await createDevice();
    const { token } = await pinLogin({
      userId: user.id,
      pin: user.pin,
      deviceToken: device.token,
      ip: unique("ip"),
    });
    const response = await counterRecoPost(
      request("/api/counter/recommendations", body, { session: token }),
    );
    expect(response.status).toBe(200);
    const { suggestions } = (await response.json()).data;
    expect(
      suggestions.map((s: { menuItemId: string }) => s.menuItemId),
    ).toEqual([catalog.items.croissant.id]);
  });
});
