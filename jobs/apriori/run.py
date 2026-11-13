"""`npm run reco:run`: mine the order history and activate the new rules.

Reads DATABASE_URL from the environment or the project's .env. Prints a
summary for people, or one JSON line with --json (used by the worker).
Exit code 0 when the run succeeded, was skipped or another run was busy;
1 when it failed.
"""

import argparse
import json
import os
import sys
from pathlib import Path

import db as store
from job import JobResult, run_job

ROOT = Path(__file__).resolve().parents[2]
TOP_RULES_SHOWN = 15


def env_file_value(path: Path, key: str) -> str | None:
    if not path.exists():
        return None
    for line in path.read_text(encoding="utf-8").splitlines():
        name, sep, value = line.strip().partition("=")
        if sep and name.strip() == key and not name.startswith("#"):
            return value.strip().strip("'\"")
    return None


def database_url() -> str:
    url = os.environ.get("DATABASE_URL") or env_file_value(ROOT / ".env", "DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set (see .env.example)")
    return url


def summary(result: JobResult) -> dict:
    return {
        "status": result.status,
        "runId": result.run_id,
        "baskets": result.baskets,
        "seeded": result.seeded,
        "rules": len(result.rules),
        "note": result.note,
    }


def print_report(db: store.Db, result: JobResult) -> None:
    print(f"Run {result.run_id or '-'}: {result.status}")
    if result.thresholds:
        t = result.thresholds
        print(
            f"Thresholds: support ≥ {t.min_support}, confidence ≥ {t.min_confidence}, "
            f"lift ≥ {t.min_lift}; at least {result.min_orders} orders"
        )
    print(f"Baskets: {result.baskets} ({result.seeded} from seeded orders)")
    print(result.note)
    if not result.rules:
        return
    names = store.item_names(db)
    print(f"\nTop rules by lift ({len(result.rules)} in total):")
    print(f"{'rule':<52} {'support':>8} {'conf.':>8} {'lift':>7}")
    for rule in result.rules[:TOP_RULES_SHOWN]:
        antecedent = " + ".join(names.get(i, i) for i in rule.antecedent)
        text = f"{antecedent} → {names.get(rule.consequent, rule.consequent)}"
        print(f"{text:<52} {rule.support:>8.4f} {rule.confidence:>8.3f} {rule.lift:>7.2f}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", action="store_true", help="print one JSON line")
    args = parser.parse_args(argv)

    db = store.connect(database_url())
    try:
        result = run_job(db)
        if args.json:
            print(json.dumps(summary(result)))
        else:
            print_report(db, result)
    finally:
        db.close()
    return 1 if result.status == "failed" else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
