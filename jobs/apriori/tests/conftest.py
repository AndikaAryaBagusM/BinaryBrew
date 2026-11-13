"""Database fixture for the job tests.

`npm run test:reco` migrates a fresh empty test database first and passes its
URL as RECO_TEST_DATABASE_URL. Each test runs in a transaction that is rolled
back, so the database stays empty.
"""

import os

import pytest

import db as store
from run import ROOT, env_file_value


class _Rollback(Exception):
    pass


def empty_test_database_url() -> str:
    url = os.environ.get("RECO_TEST_DATABASE_URL")
    if url:
        return url
    test_url = os.environ.get("TEST_DATABASE_URL") or env_file_value(
        ROOT / ".env", "TEST_DATABASE_URL"
    )
    if not test_url:
        pytest.fail("TEST_DATABASE_URL is not set (see .env.example)")
    base, _, query = test_url.partition("?")
    if not base.endswith("_test"):
        pytest.fail("the test database name must end in _test")
    return base[: -len("_test")] + "_empty_test" + (f"?{query}" if query else "")


@pytest.fixture
def database_url() -> str:
    return empty_test_database_url()


@pytest.fixture
def db(database_url):
    connection = store.connect(database_url)
    try:
        # The outer transaction: the job's own transactions become savepoints.
        with pytest.raises(_Rollback):
            with connection.transaction():
                yield connection
                raise _Rollback
    finally:
        connection.close()
