// Runtime scoring of the nightly rules (Tech §10, FR-RC-02, FR-RC-03). Pure:
// the service loads the rules, items and settings and logs what is shown.

export type ActiveRule = {
  ruleId: string;
  antecedent: readonly string[];
  consequentId: string;
  confidence: number;
  lift: number;
};

// Active items of active categories, in menu order. marginPct is in 0–1 and
// 0 for an item without a complete recipe.
export type CandidateItem = {
  id: string;
  name: string;
  isAvailable: boolean;
  isPromoted: boolean;
  marginPct: number;
};

export type ScoringWeights = {
  promoteWeight: number;
  marginWeight: number;
  maxItems: number;
};

export type Suggestion =
  | {
      source: "rule";
      itemId: string;
      ruleId: string;
      score: number;
      // The cart items that triggered the rule, in rule order.
      antecedent: readonly string[];
    }
  | {
      source: "promoted";
      itemId: string;
      ruleId: null;
      score: null;
      antecedent: readonly [];
    };

type RuleSuggestion = Extract<Suggestion, { source: "rule" }>;
type Ranked = RuleSuggestion & {
  confidence: number;
  lift: number;
  name: string;
};

// Higher score first; ties by confidence, lift, then name, so the same data
// always gives the same suggestions.
function compare(a: Ranked, b: Ranked): number {
  return (
    b.score - a.score ||
    b.confidence - a.confidence ||
    b.lift - a.lift ||
    a.name.localeCompare(b.name, "id") ||
    a.ruleId.localeCompare(b.ruleId)
  );
}

export function scoreSuggestions({
  cart,
  rules,
  items,
  weights,
}: {
  cart: readonly string[];
  rules: readonly ActiveRule[];
  items: readonly CandidateItem[];
  weights: ScoringWeights;
}): Suggestion[] {
  const inCart = new Set(cart);
  if (inCart.size === 0 || weights.maxItems < 1) return [];
  const byId = new Map(items.map((item) => [item.id, item]));
  const offerable = (id: string) =>
    !inCart.has(id) && byId.get(id)?.isAvailable === true;

  // 1–4: rules whose antecedent is in the cart, for items not in it and
  // available; the best rule per item.
  const best = new Map<string, Ranked>();
  for (const rule of rules) {
    if (!rule.antecedent.every((id) => inCart.has(id))) continue;
    if (!offerable(rule.consequentId)) continue;
    const item = byId.get(rule.consequentId)!;
    const score =
      rule.confidence *
      (1 + weights.promoteWeight * (item.isPromoted ? 1 : 0)) *
      (1 + weights.marginWeight * item.marginPct);
    const ranked: Ranked = {
      source: "rule",
      itemId: item.id,
      ruleId: rule.ruleId,
      score,
      antecedent: rule.antecedent,
      confidence: rule.confidence,
      lift: rule.lift,
      name: item.name,
    };
    const current = best.get(item.id);
    if (!current || compare(ranked, current) < 0) best.set(item.id, ranked);
  }

  if (best.size > 0) {
    return [...best.values()]
      .sort(compare)
      .slice(0, weights.maxItems)
      .map(({ source, itemId, ruleId, score, antecedent }) => ({
        source,
        itemId,
        ruleId,
        score,
        antecedent,
      }));
  }

  // 5: no rule matched; the first promoted item on the menu, if any.
  const promoted = items.find((item) => item.isPromoted && offerable(item.id));
  return promoted
    ? [
        {
          source: "promoted",
          itemId: promoted.id,
          ruleId: null,
          score: null,
          antecedent: [],
        },
      ]
    : [];
}
