import os
import threading
import duckdb

DB_PATH = os.getenv("DB_PATH", "bnb.duckdb")

_local = threading.local()


def get_conn() -> duckdb.DuckDBPyConnection:
    """Return a per-thread DuckDB connection (thread-safe, read-only)."""
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = duckdb.connect(DB_PATH, read_only=True)
        _local.conn.execute("SET threads=1")
    return _local.conn
