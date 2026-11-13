"""Apriori rule mining (Tech §10). Pure: baskets in, rules out.

A basket is the set of distinct menu item ids of one paid order. Rules have
an antecedent of one or two items and a single consequent. Values are rounded
to the precision of the association_rules columns.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from importlib.metadata import version

import numpy as np
import pandas as pd
from mlxtend.frequent_patterns import apriori, association_rules
from mlxtend.preprocessing import TransactionEncoder

MAX_LEN = 3  # antecedent up to 2 items + 1 consequent (fixed, Tech §10)
LIBRARY = f"mlxtend {version('mlxtend')}"


@dataclass(frozen=True)
class Thresholds:
    min_support: float
    min_confidence: float
    min_lift: float


@dataclass(frozen=True)
class Rule:
    antecedent: tuple[str, ...]  # sorted
    consequent: str
    support: float  # share of baskets with antecedent and consequent
    confidence: float  # share of antecedent baskets that have the consequent
    lift: float  # confidence / share of baskets with the consequent


def mine_rules(
    baskets: Sequence[Iterable[str]], thresholds: Thresholds
) -> list[Rule]:
    """Rules that pass all three thresholds, strongest lift first."""
    transactions = [sorted(set(basket)) for basket in baskets]
    transactions = [t for t in transactions if t]
    if not transactions:
        return []

    encoder = TransactionEncoder()
    matrix = encoder.fit(transactions).transform(transactions)
    frame = pd.DataFrame(matrix, columns=encoder.columns_)
    itemsets = apriori(
        frame,
        min_support=thresholds.min_support,
        use_colnames=True,
        max_len=MAX_LEN,
    )
    if len(itemsets) < 2:
        return []
    # mlxtend also computes metrics we do not use; some divide by zero when
    # an item is in every basket.
    with np.errstate(divide="ignore", invalid="ignore"):
        found = association_rules(
            itemsets,
            num_itemsets=len(transactions),
            metric="confidence",
            min_threshold=thresholds.min_confidence,
        )

    rules = []
    for row in found.itertuples(index=False):
        if len(row.consequents) != 1 or not 1 <= len(row.antecedents) <= 2:
            continue
        if row.lift < thresholds.min_lift:
            continue
        rules.append(
            Rule(
                antecedent=tuple(sorted(row.antecedents)),
                consequent=next(iter(row.consequents)),
                support=round(float(row.support), 5),
                confidence=round(float(row.confidence), 5),
                lift=round(float(row.lift), 4),
            )
        )
    # A fixed order, so the same baskets always give the same output.
    rules.sort(key=lambda r: (-r.lift, -r.confidence, r.antecedent, r.consequent))
    return rules
