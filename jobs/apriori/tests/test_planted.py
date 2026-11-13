"""The planted pairings of the demo history are recovered (docs/06 §7).

fixtures/seed_baskets.json holds the baskets (item names) that
`npm run seed:orders -- --end-date=2026-10-31` writes; a Vitest test
(tests/unit/reco-fixture.test.ts) keeps it equal to the generator.
"""

import json
from pathlib import Path

import pytest

from db import DEFAULT_SETTINGS
from mining import Thresholds, mine_rules

PLANTED = [
    ("Kopi Susu Gula Aren", "Croissant", 0.35),
    ("Americano", "Brownie", 0.25),
    ("Es Teh Lemon", "Kentang Goreng", 0.30),
    ("Latte", "Roti Bakar", 0.20),
]

DEFAULTS = Thresholds(
    min_support=DEFAULT_SETTINGS["reco_min_support"],
    min_confidence=DEFAULT_SETTINGS["reco_min_confidence"],
    min_lift=DEFAULT_SETTINGS["reco_min_lift"],
)


@pytest.fixture(scope="module")
def rules():
    path = Path(__file__).parent / "fixtures" / "seed_baskets.json"
    baskets = json.loads(path.read_text(encoding="utf-8"))
    assert len(baskets) >= DEFAULT_SETTINGS["reco_min_orders"]
    return mine_rules(baskets, DEFAULTS)


@pytest.mark.parametrize(("antecedent", "consequent", "target"), PLANTED)
def test_planted_rule_found_near_its_target(rules, antecedent, consequent, target):
    rule = next(
        (r for r in rules if r.antecedent == (antecedent,) and r.consequent == consequent),
        None,
    )
    assert rule is not None, f"{antecedent} → {consequent} not found"
    assert abs(rule.confidence - target) <= 0.07
    assert rule.lift > 1.05
