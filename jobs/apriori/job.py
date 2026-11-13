"""The recommendation job, step by step (Schema §5.7, Flow §8)."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

import db as store
from mining import LIBRARY, Rule, Thresholds, mine_rules

NOTE_LIMIT = 500


@dataclass(frozen=True)
class JobResult:
    # succeeded | skipped_insufficient_data | failed | already_running
    status: str
    run_id: str | None = None
    baskets: int = 0
    seeded: int = 0
    thresholds: Thresholds | None = None
    min_orders: int | None = None
    rules: list[Rule] = field(default_factory=list)
    note: str = ""


Miner = Callable[[Sequence[Sequence[str]], Thresholds], list[Rule]]


def run_job(db: store.Db, mine: Miner = mine_rules) -> JobResult:
    """Mines the paid orders and makes the new rules the active ones. Old
    rules stay active when the run is skipped or fails."""
    if not store.try_lock(db):
        return JobResult(status="already_running", note="another run is in progress")
    try:
        return _run_locked(db, mine)
    finally:
        store.unlock(db)


def _run_locked(db: store.Db, mine: Miner) -> JobResult:
    # 1. Run record with the thresholds from settings.
    with db.transaction():
        settings = store.read_settings(db)
        run_id = store.insert_run(db, settings.thresholds, LIBRARY)
    result = JobResult(
        status="running",
        run_id=run_id,
        thresholds=settings.thresholds,
        min_orders=settings.min_orders,
    )

    try:
        # 2. Baskets.
        baskets = store.read_baskets(db)
        count = len(baskets.items)
        result = JobResult(
            **{**result.__dict__, "baskets": count, "seeded": baskets.seeded}
        )
        described = f"{count} baskets ({baskets.seeded} seeded)"

        # 3. Too little data: keep the previous rules.
        if count < settings.min_orders:
            note = (
                f"{described}, fewer than the minimum {settings.min_orders}; "
                "previous rules stay active"
            )
            with db.transaction():
                store.finish_run(db, run_id, "skipped_insufficient_data", count, note)
            return JobResult(
                **{**result.__dict__, "status": "skipped_insufficient_data", "note": note}
            )

        # 4. Mine; store the rules inactive.
        rules = mine(baskets.items, settings.thresholds)
        with db.transaction():
            store.insert_rules(db, run_id, rules)

        # 5. Swap in one transaction.
        note = f"{described}, {len(rules)} rules"
        with db.transaction():
            store.activate_rules(db, run_id)
            store.finish_run(db, run_id, "succeeded", count, note)
        return JobResult(
            **{**result.__dict__, "status": "succeeded", "rules": rules, "note": note}
        )
    except Exception as error:  # recorded on the run, then reported
        note = f"{type(error).__name__}: {error}"[:NOTE_LIMIT]
        with db.transaction():
            store.finish_run(db, run_id, "failed", result.baskets or None, note)
        return JobResult(**{**result.__dict__, "status": "failed", "note": note})
