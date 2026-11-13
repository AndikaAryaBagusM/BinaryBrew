"""run_job against the empty test database (Schema §5.7, Tech §12): skip
under the minimum, atomic swap of the active rules, failures keep the old
rules, one run at a time."""

import json
import uuid

import pytest

import db as store
from job import run_job
from mining import LIBRARY, Rule, Thresholds


class Shop:
    """A category, menu items and a staff user, plus helpers for orders."""

    def __init__(self, db: store.Db, names: list[str]):
        self.db = db
        self.queue = 0
        [[category]] = db.run(
            "insert into categories (name) values ('Reco test') returning id::text"
        )
        self.items = {}
        for name in names:
            [[item_id]] = db.run(
                """insert into menu_items (category_id, name, price)
                   values (cast(:category as uuid), :name, 10000) returning id::text""",
                category=category,
                name=name,
            )
            self.items[name] = item_id
        [[self.staff]] = db.run(
            """insert into users (name, role, pin_hash)
               values ('Reco staff', 'staff', 'not-a-real-hash') returning id::text"""
        )

    def order(self, names: list[str], *, status="completed", seed=False):
        paid = status != "awaiting_payment"
        if paid:
            self.queue += 1
        [[order_id]] = self.db.run(
            """
            insert into orders (public_token, business_date, queue_number, channel, status,
              created_by, subtotal, total, paid_at, is_seed, voided_at, voided_by, void_reason)
            values (:token, '2026-10-01', :queue, 'counter', cast(:status as order_status),
              cast(:staff as uuid), :total, :total, :paid_at, :seed,
              :voided_at, cast(:voided_by as uuid), :reason)
            returning id::text
            """,
            token=uuid.uuid4().hex[:22],
            queue=self.queue if paid else None,
            status=status,
            staff=self.staff,
            total=10000 * len(names),
            paid_at="2026-10-01T03:00:00Z" if paid else None,
            seed=seed,
            voided_at="2026-10-01T04:00:00Z" if status == "voided" else None,
            voided_by=self.staff if status == "voided" else None,
            reason="test" if status == "voided" else None,
        )
        for position, name in enumerate(names):
            self.db.run(
                """insert into order_items (order_id, menu_item_id, name_snapshot, unit_price,
                     quantity, line_total, position)
                   values (cast(:order_id as uuid), cast(:item as uuid), :name, 10000, 1, 10000,
                     :position)""",
                order_id=order_id,
                item=self.items[name],
                name=name,
                position=position,
            )

    def setting(self, key: str, value):
        self.db.run(
            "insert into settings (key, value) values (:key, cast(:value as jsonb))",
            key=key,
            value=json.dumps(value),
        )

    def earlier_active_run(self) -> str:
        """A previous successful run with one active rule A → B."""
        run_id = store.insert_run(self.db, Thresholds(0.1, 0.1, 1.0), LIBRARY)
        rule = Rule((self.items["A"],), self.items["B"], 0.5, 0.5, 1.5)
        store.insert_rules(self.db, run_id, [rule])
        store.activate_rules(self.db, run_id)
        store.finish_run(self.db, run_id, "succeeded", 10, "earlier")
        return run_id


def active_rules(db: store.Db):
    return db.run(
        """select run_id::text, antecedent::text[], consequent_id::text
           from association_rules where is_active order by consequent_id"""
    )


def run_row(db: store.Db, run_id: str):
    [row] = db.run(
        """select status, transactions_count, min_support::float8, min_confidence::float8,
                  min_lift::float8, library, note, finished_at is not null
           from association_rule_runs where id = cast(:id as uuid)""",
        id=run_id,
    )
    return row


def basket_orders(shop: Shop):
    # coffee ↔ cake together in 4 of 6 coffee orders; tea alone.
    for _ in range(4):
        shop.order(["coffee", "cake"], seed=True)
    shop.order(["coffee"])
    shop.order(["coffee"])
    for _ in range(4):
        shop.order(["tea"])


def test_success_activates_only_the_new_rules(db):
    shop = Shop(db, ["A", "B", "coffee", "cake", "tea"])
    old_run = shop.earlier_active_run()
    shop.setting("reco_min_orders", 10)
    basket_orders(shop)

    result = run_job(db)

    assert result.status == "succeeded"
    assert (result.baskets, result.seeded) == (10, 4)
    pairs = {(r.antecedent, r.consequent) for r in result.rules}
    assert pairs == {
        ((shop.items["cake"],), shop.items["coffee"]),
        ((shop.items["coffee"],), shop.items["cake"]),
    }
    assert {row[0] for row in active_rules(db)} == {result.run_id}
    assert len(active_rules(db)) == 2
    assert old_run != result.run_id
    # Thresholds are the defaults, recorded on the run.
    assert run_row(db, result.run_id) == [
        "succeeded",
        10,
        0.02,
        0.15,
        1.05,
        LIBRARY,
        "10 baskets (4 seeded), 2 rules",
        True,
    ]


def test_too_few_orders_skips_and_keeps_the_old_rules(db):
    shop = Shop(db, ["A", "B", "coffee", "cake", "tea"])
    old_run = shop.earlier_active_run()
    basket_orders(shop)  # 10 baskets, default minimum 300

    result = run_job(db)

    assert result.status == "skipped_insufficient_data"
    assert result.rules == []
    assert [row[0] for row in active_rules(db)] == [old_run]
    status, count, *_, note, finished = run_row(db, result.run_id)
    assert (status, count, finished) == ("skipped_insufficient_data", 10, True)
    assert "fewer than the minimum 300" in note


def test_only_paid_orders_that_are_not_voided_are_baskets(db):
    shop = Shop(db, ["coffee", "cake"])
    shop.setting("reco_min_orders", 0)
    shop.order(["coffee", "cake"])
    shop.order(["coffee", "cake", "coffee"])  # repeated line: one basket item
    shop.order(["cake"], status="awaiting_payment")
    shop.order(["cake"], status="voided")
    shop.order(["coffee"], status="paid")

    baskets = store.read_baskets(db)

    assert sorted(len(b) for b in baskets.items) == [1, 2, 2]
    assert run_job(db).baskets == 3


def test_a_failed_run_is_recorded_and_keeps_the_old_rules(db):
    shop = Shop(db, ["A", "B", "coffee", "cake", "tea"])
    old_run = shop.earlier_active_run()
    shop.setting("reco_min_orders", 0)
    basket_orders(shop)

    def broken_miner(baskets, thresholds):
        # A consequent that is not a menu item fails the foreign key.
        return [Rule((shop.items["A"],), str(uuid.uuid4()), 0.5, 0.5, 2.0)]

    result = run_job(db, mine=broken_miner)

    assert result.status == "failed"
    assert [row[0] for row in active_rules(db)] == [old_run]
    [[new_rules]] = db.run(
        "select count(*) from association_rules where run_id = cast(:id as uuid)",
        id=result.run_id,
    )
    assert new_rules == 0
    status, count, *_, note, finished = run_row(db, result.run_id)
    assert (status, count, finished) == ("failed", 10, True)
    assert "foreign key" in note


def test_only_one_run_at_a_time(db, database_url):
    other = store.connect(database_url)
    try:
        assert store.try_lock(other)
        assert run_job(db).status == "already_running"
    finally:
        store.unlock(other)
        other.close()


def test_bad_setting_values_stop_the_run(db):
    shop = Shop(db, ["coffee"])
    shop.setting("reco_min_confidence", 1.5)
    with pytest.raises(ValueError, match="reco_min_confidence"):
        run_job(db)
    [[runs]] = db.run("select count(*) from association_rule_runs")
    assert runs == 0
