"""Database side of the recommendation job (Schema §5.7).

Uses pg8000 (pure Python). Transactions nest: inside an open transaction a
block becomes a savepoint, so tests can wrap a whole run and roll it back.
"""

import json
from contextlib import contextmanager
from dataclasses import dataclass
from urllib.parse import unquote, urlparse

import pg8000.native

from mining import Thresholds

# Same defaults as src/modules/settings/definitions.ts (a Vitest test keeps
# them equal); used only when the owner never saved the setting.
DEFAULT_SETTINGS = {
    "reco_min_support": 0.02,
    "reco_min_confidence": 0.15,
    "reco_min_lift": 1.05,
    "reco_min_orders": 300,
}

# One run at a time (manual run and the 03:00 run).
LOCK_KEY = "reco:run"


class Db:
    def __init__(self, connection: pg8000.native.Connection):
        self.connection = connection
        self._depth = 0

    def run(self, sql: str, **params):
        return self.connection.run(sql, **params)

    @contextmanager
    def transaction(self):
        name = f"sp_{self._depth}"
        self.run("start transaction" if self._depth == 0 else f"savepoint {name}")
        self._depth += 1
        try:
            yield self
        except BaseException:
            self._depth -= 1
            self.run("rollback" if self._depth == 0 else f"rollback to savepoint {name}")
            raise
        self._depth -= 1
        self.run("commit" if self._depth == 0 else f"release savepoint {name}")

    def close(self):
        self.connection.close()


def connect(url: str) -> Db:
    parts = urlparse(url)
    return Db(
        pg8000.native.Connection(
            user=unquote(parts.username or ""),
            password=unquote(parts.password or "") or None,
            host=parts.hostname or "localhost",
            port=parts.port or 5432,
            database=parts.path.lstrip("/"),
        )
    )


def try_lock(db: Db) -> bool:
    [[locked]] = db.run(
        "select pg_try_advisory_lock(hashtextextended(:key, 0))", key=LOCK_KEY
    )
    return bool(locked)


def unlock(db: Db) -> None:
    db.run("select pg_advisory_unlock(hashtextextended(:key, 0))", key=LOCK_KEY)


@dataclass(frozen=True)
class Settings:
    thresholds: Thresholds
    min_orders: int


def _number(key: str, value, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"setting {key} is not a number")
    if not low <= value <= high:
        raise ValueError(f"setting {key} is outside {low}–{high}")
    return float(value)


def read_settings(db: Db) -> Settings:
    rows = db.run(
        "select key, value::text from settings where key = any(:keys)",
        keys=list(DEFAULT_SETTINGS),
    )
    values = {**DEFAULT_SETTINGS, **{key: json.loads(text) for key, text in rows}}
    min_orders = values["reco_min_orders"]
    if isinstance(min_orders, bool) or not isinstance(min_orders, int) or min_orders < 0:
        raise ValueError("setting reco_min_orders is not a whole number ≥ 0")
    return Settings(
        thresholds=Thresholds(
            min_support=_number("reco_min_support", values["reco_min_support"], 0, 1),
            min_confidence=_number(
                "reco_min_confidence", values["reco_min_confidence"], 0, 1
            ),
            min_lift=_number("reco_min_lift", values["reco_min_lift"], 0, 100),
        ),
        min_orders=min_orders,
    )


@dataclass(frozen=True)
class Baskets:
    items: list[list[str]]  # distinct menu item ids per order
    seeded: int  # how many come from orders flagged is_seed


def read_baskets(db: Db) -> Baskets:
    """One basket per paid, non-voided order (Schema §5.7 step 2)."""
    rows = db.run(
        """
        select array_agg(distinct oi.menu_item_id::text order by oi.menu_item_id::text),
               o.is_seed
        from orders o
        join order_items oi on oi.order_id = o.id
        where o.paid_at is not null and o.status <> 'voided'
        group by o.id
        order by o.id
        """
    )
    return Baskets(
        items=[items for items, _ in rows],
        seeded=sum(1 for _, is_seed in rows if is_seed),
    )


def insert_run(db: Db, thresholds: Thresholds, library: str) -> str:
    [[run_id]] = db.run(
        """
        insert into association_rule_runs (status, min_support, min_confidence, min_lift, library)
        values ('running', :support, :confidence, :lift, :library)
        returning id::text
        """,
        support=thresholds.min_support,
        confidence=thresholds.min_confidence,
        lift=thresholds.min_lift,
        library=library,
    )
    return run_id


def finish_run(
    db: Db, run_id: str, status: str, transactions: int | None, note: str
) -> None:
    db.run(
        """
        update association_rule_runs
        set status = :status, finished_at = now(), transactions_count = :transactions,
            note = :note
        where id = cast(:run_id as uuid)
        """,
        run_id=run_id,
        status=status,
        transactions=transactions,
        note=note,
    )


def insert_rules(db: Db, run_id: str, rules) -> None:
    """Step 4: the new rules, not active yet."""
    for rule in rules:
        db.run(
            """
            insert into association_rules
              (run_id, antecedent, consequent_id, support, confidence, lift, is_active)
            values (cast(:run_id as uuid), cast(:antecedent as uuid[]),
                    cast(:consequent as uuid), :support, :confidence, :lift, false)
            """,
            run_id=run_id,
            antecedent=list(rule.antecedent),
            consequent=rule.consequent,
            support=rule.support,
            confidence=rule.confidence,
            lift=rule.lift,
        )


def activate_rules(db: Db, run_id: str) -> None:
    """Step 5 (inside the caller's transaction): only this run's rules are
    active."""
    db.run(
        """
        update association_rules set is_active = false
        where is_active and run_id <> cast(:run_id as uuid)
        """,
        run_id=run_id,
    )
    db.run(
        "update association_rules set is_active = true where run_id = cast(:run_id as uuid)",
        run_id=run_id,
    )


def item_names(db: Db) -> dict[str, str]:
    return {item_id: name for item_id, name in db.run("select id::text, name from menu_items")}
