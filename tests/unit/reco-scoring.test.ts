import { describe, expect, it } from "vitest";
import {
  type ActiveRule,
  type CandidateItem,
  scoreSuggestions,
} from "@/modules/recommendations/scoring";

// Runtime scoring (Tech §10 steps 1–5, FR-RC-02, FR-RC-03).

const item = (
  id: string,
  extra: Partial<CandidateItem> = {},
): CandidateItem => ({
  id,
  name: id,
  isAvailable: true,
  isPromoted: false,
  marginPct: 0,
  ...extra,
});

const rule = (
  ruleId: string,
  antecedent: string[],
  consequentId: string,
  confidence: number,
  lift = 2,
): ActiveRule => ({ ruleId, antecedent, consequentId, confidence, lift });

const weights = { promoteWeight: 0.5, marginWeight: 0.25, maxItems: 2 };
const menu = ["kopi", "latte", "croissant", "brownie", "roti", "kentang"].map(
  (id) => item(id),
);

const ids = (suggestions: ReturnType<typeof scoreSuggestions>) =>
  suggestions.map((s) => s.itemId);

describe("scoreSuggestions", () => {
  it("suggests consequents of rules whose antecedent is in the cart", () => {
    const result = scoreSuggestions({
      cart: ["kopi"],
      rules: [
        rule("r1", ["kopi"], "croissant", 0.35),
        rule("r2", ["latte"], "roti", 0.9), // antecedent not in cart
        rule("r3", ["kopi", "latte"], "brownie", 0.8), // only half in cart
      ],
      items: menu,
      weights,
    });
    expect(result).toEqual([
      {
        source: "rule",
        itemId: "croissant",
        ruleId: "r1",
        score: 0.35,
        antecedent: ["kopi"],
      },
    ]);
  });

  it("matches a two-item antecedent when both are in the cart", () => {
    const result = scoreSuggestions({
      cart: ["latte", "kopi"],
      rules: [rule("r3", ["kopi", "latte"], "brownie", 0.4)],
      items: menu,
      weights,
    });
    expect(ids(result)).toEqual(["brownie"]);
  });

  it("drops items already in the cart, sold out or not on the menu", () => {
    const result = scoreSuggestions({
      cart: ["kopi", "croissant"],
      rules: [
        rule("r1", ["kopi"], "croissant", 0.9),
        rule("r2", ["kopi"], "brownie", 0.8),
        rule("r3", ["kopi"], "gone", 0.7),
        rule("r4", ["kopi"], "roti", 0.2),
      ],
      items: menu.map((i) =>
        i.id === "brownie" ? { ...i, isAvailable: false } : i,
      ),
      weights,
    });
    expect(ids(result)).toEqual(["roti"]);
  });

  it("boosts promoted items and items with margin", () => {
    const result = scoreSuggestions({
      cart: ["kopi"],
      rules: [
        rule("r1", ["kopi"], "croissant", 0.3),
        rule("r2", ["kopi"], "roti", 0.25),
        rule("r3", ["kopi"], "kentang", 0.26),
      ],
      items: menu.map((i) =>
        i.id === "roti"
          ? { ...i, isPromoted: true }
          : i.id === "kentang"
            ? { ...i, marginPct: 0.8 }
            : i,
      ),
      weights: { ...weights, maxItems: 3 },
    });
    // roti 0.25 × 1.5 = 0.375; kentang 0.26 × 1.2 = 0.312; croissant 0.3
    expect(result.map((s) => [s.itemId, s.score])).toEqual([
      ["roti", 0.375],
      ["kentang", expect.closeTo(0.312, 10)],
      ["croissant", 0.3],
    ]);
  });

  it("keeps the best rule per item and the top maxItems", () => {
    const result = scoreSuggestions({
      cart: ["kopi", "latte"],
      rules: [
        rule("r1", ["kopi"], "croissant", 0.2),
        rule("r2", ["latte"], "croissant", 0.5),
        rule("r3", ["kopi"], "brownie", 0.3),
        rule("r4", ["kopi"], "roti", 0.1),
      ],
      items: menu,
      weights,
    });
    expect(result.map((s) => [s.itemId, s.ruleId])).toEqual([
      ["croissant", "r2"],
      ["brownie", "r3"],
    ]);
  });

  it("breaks ties by confidence, lift, then name", () => {
    const result = scoreSuggestions({
      cart: ["kopi"],
      rules: [
        rule("r1", ["kopi"], "roti", 0.3, 1.5),
        rule("r2", ["kopi"], "brownie", 0.3, 2.5),
        rule("r3", ["kopi"], "croissant", 0.3, 1.5),
      ],
      items: menu,
      weights: { ...weights, maxItems: 3 },
    });
    expect(ids(result)).toEqual(["brownie", "croissant", "roti"]);
  });

  it("falls back to the first promoted available item when no rule matches", () => {
    const items = menu.map((i) =>
      ["roti", "kentang"].includes(i.id) ? { ...i, isPromoted: true } : i,
    );
    expect(
      scoreSuggestions({ cart: ["kopi"], rules: [], items, weights }),
    ).toEqual([
      {
        source: "promoted",
        itemId: "roti",
        ruleId: null,
        score: null,
        antecedent: [],
      },
    ]);
    // Not one already in the cart or sold out.
    expect(
      ids(
        scoreSuggestions({
          cart: ["roti"],
          rules: [],
          items: items.map((i) =>
            i.id === "kentang" ? { ...i, isAvailable: false } : i,
          ),
          weights,
        }),
      ),
    ).toEqual([]);
  });

  it("does not add the promoted item when a rule matched", () => {
    const result = scoreSuggestions({
      cart: ["kopi"],
      rules: [rule("r1", ["kopi"], "croissant", 0.3)],
      items: menu.map((i) =>
        i.id === "roti" ? { ...i, isPromoted: true } : i,
      ),
      weights,
    });
    expect(ids(result)).toEqual(["croissant"]);
  });

  it("suggests nothing for an empty cart or a limit of 0", () => {
    const items = menu.map((i) => ({ ...i, isPromoted: true }));
    expect(scoreSuggestions({ cart: [], rules: [], items, weights })).toEqual(
      [],
    );
    expect(
      scoreSuggestions({
        cart: ["kopi"],
        rules: [],
        items,
        weights: { ...weights, maxItems: 0 },
      }),
    ).toEqual([]);
  });
});
