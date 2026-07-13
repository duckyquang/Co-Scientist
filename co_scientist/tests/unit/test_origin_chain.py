"""Rerun-chain linkage: origin_session_id stamping (webapp path).

A chat "tweak" spawns a NEW session whose origin_session_id points at the
chain's ROOT (child.origin = parent.origin ?? parent.id), so the dashboard can
collapse a rerun chain into one card.
"""

from __future__ import annotations

import sqlite3


def test_start_session_stamps_origin(tmp_path, monkeypatch):
    from webapp import server, store

    monkeypatch.setattr(server.simulator, "start", lambda *a, **k: None)
    conn = store.connect(tmp_path / "t.db")

    root = server.Handler._start_session(None, conn, "goal about widget physics")
    child = server.Handler._start_session(
        None, conn, "goal about widget physics, tweaked", origin_session_id=root)
    # A tweak from the child chains back to the ORIGINAL root.
    child_row = store.get_session(conn, child)
    grandchild = server.Handler._start_session(
        None, conn, "goal tweaked twice",
        origin_session_id=child_row.get("origin_session_id") or child)

    rows = {r["id"]: r for r in store.list_sessions(conn)}
    assert rows[root]["origin_session_id"] is None
    assert rows[child]["origin_session_id"] == root
    assert rows[grandchild]["origin_session_id"] == root
    conn.close()


def test_connect_adds_column_to_legacy_db(tmp_path):
    """Pre-0007 DBs (sessions table without origin_session_id) get the column
    via the ALTER guard in store.connect; list_sessions must not 500."""
    from webapp import store

    db = tmp_path / "legacy.db"
    raw = sqlite3.connect(db)
    raw.execute(
        """CREATE TABLE sessions (
               id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
               status TEXT NOT NULL, research_goal TEXT NOT NULL, research_plan TEXT NOT NULL,
               config_snapshot TEXT NOT NULL, budget_tokens INTEGER NOT NULL,
               budget_usd REAL NOT NULL, budget_used_tokens INTEGER NOT NULL DEFAULT 0,
               budget_used_usd REAL NOT NULL DEFAULT 0, wall_deadline TEXT, final_overview TEXT
           )"""
    )
    raw.commit()
    raw.close()

    conn = store.connect(db)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(sessions)")}
    assert "origin_session_id" in cols
    assert store.list_sessions(conn) == []
    conn.close()
