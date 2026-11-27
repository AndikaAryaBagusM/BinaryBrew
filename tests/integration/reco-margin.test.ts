import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeSql, getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { randomToken } from "@/lib/ids";
import {
  ownerLogin,
  resetAuthRateLimits,
  type SessionUser,
} from "@/modules/auth/service";
import { createIngredient } from "@/modules/inventory/service";
import { setRecipe } from "@/modules/menu/service";
import {
  resetRecommendationRateLimits,
  suggestItems,
} from "@/modules/recommendations/service";
import { getSettings } from "@/modules/settings/service";
import { createUser, unique } from "./auth-fixtures";
import { createCatalog } from "./menu-fixtures";

// P2-08 acceptance (FR-RC-06): with equal confidence, the item with the
// better margin (current HPP, menu getItemCosts) ranks first; an item whose
// recipe is incomplete or missing gets no boost. Own items and rules only.

afterAll(() => closeSql());
beforeEach(() => {
  resetRecommendationRateLimits();
  resetAuthRateLimits();
});

let owner: SessionUser;
let catalog: Awaited<ReturnType<typeof createCatalog>>;
const item: Record<"kopi" | "teh" | "high" | "low" | "part" | "none", string> =
  {} as never;

async function menuItem(name: string) {
  const [row] = await getDb()
    .insert(schema.menuItems)
    .values({
      categoryId: catalog.categories.food.id,
      name: unique(name),
      price: 20_000,
    })
    .returning({ id: schema.menuItems.id });
  return row!.id;
}

async function ingredient(totalCost: number) {
  const { id } = await createIngredient(owner, {
    name: unique("Bahan"),
    kind: "raw",
    unit: "g",
    minStockQty: "0",
    isActive: true,
    opening: { quantity: "10000", totalCost },
  });
  return id;
}

beforeAll(async () => {
  const row = await createUser({ role: "owner" });
  ({ user: owner } = await ownerLogin({
    email: row.email!,
    password: row.password,
    ip: unique("ip"),
  }));
  catalog = await createCatalog();
  // Names sort "A…" before "Z…", so a tie without the boost would put the
  // low-margin item first.
  item.kopi = await menuItem("Kopi");
  item.teh = await menuItem("Teh");
  item.high = await menuItem("Z-high");
  item.low = await menuItem("A-low");
  item.part = await menuItem("A-part");
  item.none = await menuItem("Z-none");

  const beans = await ingredient(3_200_000); // Rp 320 per g
  const free = await ingredient(0); // no cost yet
  // HPP 6.000 (30 %) → margin 0,7; HPP 16.000 (80 %) → margin 0,2.
  await setRecipe(owner, item.high, [{ ingredientId: beans, qty: "18.75" }]);
  await setRecipe(owner, item.low, [{ ingredientId: beans, qty: "50" }]);
  // Incomplete: the beans alone give HPP 1.000 (margin 0,95), but one
  // ingredient has no cost yet, so the boost stays neutral.
  await setRecipe(owner, item.part, [
    { ingredientId: beans, qty: "3.125" },
    { ingredientId: free, qty: "10" },
  ]);

  const [run] = await getDb()
    .insert(schema.associationRuleRuns)
    .values({
      status: "succeeded",
      minSupport: "0.02",
      minConfidence: "0.15",
      minLift: "1.05",
    })
    .returning();
  const rule = (antecedent: string, consequentId: string) => ({
    runId: run!.id,
    antecedent: [antecedent],
    consequentId,
    support: "0.05",
    confidence: "0.3",
    lift: "2.0",
    isActive: true,
  });
  await getDb()
    .insert(schema.associationRules)
    .values([
      rule(item.kopi, item.low),
      rule(item.kopi, item.high),
      rule(item.teh, item.part),
      rule(item.teh, item.none),
    ]);
});

const shownScores = async (clientSession: string) =>
  (
    await getDb()
      .select({
        itemId: schema.recommendationEvents.itemId,
        score: schema.recommendationEvents.score,
      })
      .from(schema.recommendationEvents)
      .where(eq(schema.recommendationEvents.clientSession, clientSession))
      .orderBy(schema.recommendationEvents.id)
  ).map((event) => [event.itemId, event.score]);

describe("margin boost (FR-RC-06)", () => {
  it("ranks the higher-margin item first at equal confidence", async () => {
    const { reco_margin_weight: weight } = await getSettings([
      "reco_margin_weight",
    ]);
    const clientSession = randomToken(16);
    const suggestions = await suggestItems({
      clientSession,
      itemIds: [item.kopi],
    });
    expect(suggestions.map((s) => s.menuItemId)).toEqual([item.high, item.low]);
    // 0,3 × (1 + w × 0,7) and 0,3 × (1 + w × 0,2); 0,3525 and 0,3150 at 0,25.
    expect(await shownScores(clientSession)).toEqual([
      [item.high, (0.3 * (1 + weight * 0.7)).toFixed(4)],
      [item.low, (0.3 * (1 + weight * 0.2)).toFixed(4)],
    ]);
  });

  it("is neutral for an incomplete recipe and without one", async () => {
    const clientSession = randomToken(16);
    await suggestItems({ clientSession, itemIds: [item.teh] });
    // Equal scores: the usual tie-break by name.
    expect(await shownScores(clientSession)).toEqual([
      [item.part, "0.3000"],
      [item.none, "0.3000"],
    ]);
  });
});
