"""mine_rules on tiny fixtures with known answers (Tech §12)."""

from mining import Rule, Thresholds, mine_rules

# 10 baskets. coffee: 6, cake: 4, coffee+cake: 4, tea: 4, tea+chips: 2,
# chips: 3, coffee+cake+chips: 1.
BASKETS = [
    ["coffee", "cake"],
    ["coffee", "cake"],
    ["coffee", "cake"],
    ["coffee", "cake", "chips"],
    ["coffee"],
    ["coffee"],
    ["tea", "chips"],
    ["tea", "chips"],
    ["tea"],
    ["tea"],
]

LOOSE = Thresholds(min_support=0.1, min_confidence=0.1, min_lift=1.05)


def find(rules, antecedent, consequent):
    return next(
        (r for r in rules if r.antecedent == antecedent and r.consequent == consequent),
        None,
    )


def test_support_confidence_and_lift_match_hand_calculation():
    rules = mine_rules(BASKETS, LOOSE)
    # cake → coffee: support 4/10, confidence 4/4, lift 1 / (6/10)
    assert find(rules, ("cake",), "coffee") == Rule(
        ("cake",), "coffee", support=0.4, confidence=1.0, lift=1.6667
    )
    # coffee → cake: confidence 4/6, lift (4/6) / (4/10)
    assert find(rules, ("coffee",), "cake") == Rule(
        ("coffee",), "cake", support=0.4, confidence=0.66667, lift=1.6667
    )
    # tea → chips: support 2/10, confidence 2/4, lift 0.5 / 0.3
    assert find(rules, ("tea",), "chips") == Rule(
        ("tea",), "chips", support=0.2, confidence=0.5, lift=1.6667
    )


def test_rules_below_a_threshold_are_dropped():
    # coffee → chips has lift (1/6) / 0.3 < 1: never a rule.
    assert find(mine_rules(BASKETS, LOOSE), ("coffee",), "chips") is None
    strict = Thresholds(min_support=0.3, min_confidence=0.7, min_lift=1.05)
    assert [(r.antecedent, r.consequent) for r in mine_rules(BASKETS, strict)] == [
        (("cake",), "coffee")
    ]


def test_two_item_antecedents_at_most_and_one_consequent():
    baskets = [["a", "b", "c", "d"]] * 5 + [["a"], ["e"]]
    rules = mine_rules(baskets, LOOSE)
    assert rules
    assert all(1 <= len(r.antecedent) <= 2 for r in rules)
    assert all(r.consequent not in r.antecedent for r in rules)
    assert find(rules, ("a", "b"), "c") is not None


def test_same_baskets_same_rules_in_any_order():
    reordered = [list(reversed(b)) for b in reversed(BASKETS)]
    assert mine_rules(reordered, LOOSE) == mine_rules(BASKETS, LOOSE)


def test_duplicate_items_in_a_basket_count_once():
    assert mine_rules([b + b for b in BASKETS], LOOSE) == mine_rules(BASKETS, LOOSE)


def test_no_baskets_or_nothing_frequent_gives_no_rules():
    assert mine_rules([], LOOSE) == []
    assert mine_rules([["a"], ["b"]], Thresholds(0.9, 0.1, 1.0)) == []
