"""SQLite data-access for the web app.

Reads the *same* schema the real co-scientist engine uses
(`co_scientist/storage/schema.sql`), so a DB produced by `co-scientist run`
is browsable here, and the demo seeder writes rows the engine would accept.

Stdlib only — no aiosqlite/SQLAlchemy — so the website runs with bare python3.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_SQL = REPO_ROOT / "co_scientist" / "storage" / "schema.sql"
DEFAULT_DB = REPO_ROOT / "data" / "co_scientist.db"

_INIT_LOCK = threading.Lock()
_INITED: set[str] = set()


def connect(db_path: Path | str = DEFAULT_DB) -> sqlite3.Connection:
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    first = str(db_path) not in _INITED
    conn = sqlite3.connect(db_path, check_same_thread=False, timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=8000")
    conn.execute("PRAGMA foreign_keys=ON")
    if first:
        with _INIT_LOCK:
            if str(db_path) not in _INITED:
                conn.executescript(SCHEMA_SQL.read_text())
                # CREATE TABLE IF NOT EXISTS no-ops on pre-existing DBs, so
                # columns added to schema.sql later need an ALTER guard here.
                cols = {r[1] for r in conn.execute("PRAGMA table_info(sessions)")}
                if "origin_session_id" not in cols:
                    conn.execute("ALTER TABLE sessions ADD COLUMN origin_session_id TEXT")
                hcols = {r[1] for r in conn.execute("PRAGMA table_info(hypotheses)")}
                if "thinking" not in hcols:
                    conn.execute("ALTER TABLE hypotheses ADD COLUMN thinking TEXT")
                rcols = {r[1] for r in conn.execute("PRAGMA table_info(reviews)")}
                if "thinking" not in rcols:
                    conn.execute("ALTER TABLE reviews ADD COLUMN thinking TEXT")
                conn.commit()
                _INITED.add(str(db_path))
    return conn


def _rows(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    cur = conn.execute(sql, params)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r, strict=True)) for r in cur.fetchall()]


def _row(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> dict | None:
    out = _rows(conn, sql, params)
    return out[0] if out else None


def _loads(value: Any, default: Any) -> Any:
    if value is None or value == "":
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return default


# --------------------------------------------------------------------------- #
# Sessions
# --------------------------------------------------------------------------- #

def list_sessions(conn: sqlite3.Connection) -> list[dict]:
    rows = _rows(
        conn,
        """
        SELECT s.id, s.status, s.research_goal, s.created_at, s.updated_at,
               s.budget_usd, s.budget_used_usd, s.budget_tokens, s.budget_used_tokens,
               s.final_overview, s.origin_session_id,
               (SELECT COUNT(*) FROM hypotheses h WHERE h.session_id = s.id) AS n_hyps,
               (SELECT COUNT(*) FROM hypotheses h WHERE h.session_id = s.id
                    AND h.state = 'in_tournament') AS n_tournament,
               (SELECT MAX(elo) FROM hypotheses h WHERE h.session_id = s.id) AS top_elo,
               (SELECT COUNT(*) FROM tournament_matches m WHERE m.session_id = s.id) AS n_matches
          FROM sessions s
         ORDER BY s.updated_at DESC
         LIMIT 200
        """,
    )
    return rows


def get_session(conn: sqlite3.Connection, sid: str) -> dict | None:
    s = _row(conn, "SELECT * FROM sessions WHERE id = ?", (sid,))
    if not s:
        return None
    s["research_plan"] = _loads(s.get("research_plan"), {})
    s["config_snapshot"] = _loads(s.get("config_snapshot"), {})
    return s


def session_counts(conn: sqlite3.Connection, sid: str) -> dict:
    states = _rows(
        conn,
        "SELECT state, COUNT(*) n FROM hypotheses WHERE session_id=? GROUP BY state",
        (sid,),
    )
    tasks = _rows(
        conn,
        "SELECT status, COUNT(*) n FROM tasks WHERE session_id=? GROUP BY status",
        (sid,),
    )
    return {
        "hypothesis_states": {r["state"]: r["n"] for r in states},
        "task_status": {r["status"]: r["n"] for r in tasks},
    }


# --------------------------------------------------------------------------- #
# Hypotheses
# --------------------------------------------------------------------------- #

def list_hypotheses(conn: sqlite3.Connection, sid: str) -> list[dict]:
    rows = _rows(
        conn,
        """
        SELECT h.*,
               (SELECT COUNT(*) FROM reviews r WHERE r.hypothesis_id = h.id) AS n_reviews
          FROM hypotheses h
         WHERE h.session_id = ?
         ORDER BY (h.elo IS NULL), h.elo DESC, h.created_at ASC
        """,
        (sid,),
    )
    for h in rows:
        h["parent_ids"] = _loads(h.get("parent_ids"), [])
        h["scores"] = _avg_scores(conn, h["id"])
    return rows


def get_hypothesis(conn: sqlite3.Connection, hid: str) -> dict | None:
    h = _row(conn, "SELECT * FROM hypotheses WHERE id = ?", (hid,))
    if not h:
        return None
    h["parent_ids"] = _loads(h.get("parent_ids"), [])
    h["citations"] = _hypothesis_citations(conn, hid)
    if not h["citations"] and h.get("artifact_path"):
        h["citations"] = _artifact_citations(conn, h["artifact_path"])
    h["reviews"] = list_reviews(conn, hid)
    h["scores"] = _avg_scores(conn, hid)
    h["elo_history"] = elo_history_for(conn, hid)
    # Real-engine DBs store thinking as a column on `hypotheses` (loaded by
    # SELECT *); the demo/sim stashes it in the hyp_thinking side table. Prefer
    # the column, fall back to the side table.
    h["thinking"] = h.get("thinking") or _hypothesis_thinking(conn, hid)
    return h


def _hypothesis_thinking(conn: sqlite3.Connection, hid: str) -> str | None:
    """Varied synthetic reasoning stashed by the demo seeder / live simulator in a
    side table (see webapp/seed.py EXTRA_TABLES). None for real-engine DBs that
    have no such table."""
    try:
        row = _row(conn, "SELECT thinking FROM hyp_thinking WHERE hypothesis_id=?", (hid,))
        return row["thinking"] if row else None
    except sqlite3.OperationalError:
        return None


def _hypothesis_citations(conn: sqlite3.Connection, hid: str) -> list[dict]:
    # Citations live in the on-disk artifact JSON in the real engine; the demo
    # seeder stashes them in a side table if present, else returns [].
    try:
        rows = _rows(
            conn,
            "SELECT title, url, excerpt, doi, year FROM web_citations WHERE hypothesis_id=?",
            (hid,),
        )
        return rows
    except sqlite3.OperationalError:
        return []


def _artifact_citations(conn: sqlite3.Connection, rel_path: str) -> list[dict]:
    """Fallback for real-engine DBs: citations live only in the hypothesis
    artifact JSON ({"record": {"citations": [...]}}). Artifact paths are
    relative to the data dir, which by convention is the DB file's directory
    (Config.db_path = data_dir / "co_scientist.db"). Any failure — missing
    file, malformed JSON, traversal attempt — degrades to []."""
    try:
        db_file = next(
            r["file"] for r in conn.execute("PRAGMA database_list")
            if r["name"] == "main" and r["file"]
        )
        data_dir = Path(db_file).resolve().parent
        p = (data_dir / rel_path).resolve()
        p.relative_to(data_dir)  # refuse paths escaping the data dir
        payload = json.loads(p.read_text(encoding="utf-8"))
    except (StopIteration, OSError, ValueError):  # JSONDecodeError ⊂ ValueError
        return []
    record = payload.get("record") if isinstance(payload, dict) else None
    cites = record.get("citations") if isinstance(record, dict) else None
    return [
        {"title": c.get("title"), "url": c.get("url"), "excerpt": c.get("excerpt"),
         "doi": c.get("doi"), "year": c.get("year")}
        for c in (cites if isinstance(cites, list) else [])
        if isinstance(c, dict)
    ]


def list_reviews(conn: sqlite3.Connection, hid: str) -> list[dict]:
    return _rows(
        conn,
        "SELECT * FROM reviews WHERE hypothesis_id=? ORDER BY created_at ASC",
        (hid,),
    )


def _avg_scores(conn: sqlite3.Connection, hid: str) -> dict:
    r = _row(
        conn,
        """SELECT AVG(novelty) novelty, AVG(correctness) correctness,
                  AVG(testability) testability, AVG(feasibility) feasibility
             FROM reviews WHERE hypothesis_id=?""",
        (hid,),
    )
    return r or {}


# --------------------------------------------------------------------------- #
# Matches / Elo
# --------------------------------------------------------------------------- #

def list_matches(conn: sqlite3.Connection, sid: str, limit: int = 100) -> list[dict]:
    return _rows(
        conn,
        """SELECT m.*,
                  ha.title AS title_a, hb.title AS title_b
             FROM tournament_matches m
             LEFT JOIN hypotheses ha ON ha.id = m.hyp_a
             LEFT JOIN hypotheses hb ON hb.id = m.hyp_b
            WHERE m.session_id=?
            ORDER BY m.created_at DESC
            LIMIT ?""",
        (sid, limit),
    )


def elo_history_for(conn: sqlite3.Connection, hid: str) -> list[dict]:
    rows = _rows(
        conn,
        """SELECT created_at, hyp_a, hyp_b, winner, elo_a_after, elo_b_after
             FROM tournament_matches
            WHERE (hyp_a=? OR hyp_b=?) AND winner IS NOT NULL
            ORDER BY created_at ASC""",
        (hid, hid),
    )
    out = []
    for r in rows:
        if r["hyp_a"] == hid and r["elo_a_after"] is not None:
            out.append({"t": r["created_at"], "elo": r["elo_a_after"]})
        elif r["hyp_b"] == hid and r["elo_b_after"] is not None:
            out.append({"t": r["created_at"], "elo": r["elo_b_after"]})
    return out


def elo_history_all(conn: sqlite3.Connection, sid: str) -> dict[str, list[dict]]:
    rows = _rows(
        conn,
        """SELECT created_at, hyp_a, hyp_b, winner, elo_a_after, elo_b_after
             FROM tournament_matches
            WHERE session_id=? AND winner IS NOT NULL
            ORDER BY created_at ASC""",
        (sid,),
    )
    out: dict[str, list[dict]] = {}
    for i, r in enumerate(rows):
        if r["elo_a_after"] is not None:
            out.setdefault(r["hyp_a"], []).append({"i": i, "elo": r["elo_a_after"]})
        if r["elo_b_after"] is not None:
            out.setdefault(r["hyp_b"], []).append({"i": i, "elo": r["elo_b_after"]})
    return out


# --------------------------------------------------------------------------- #
# Transcripts (cost analytics)
# --------------------------------------------------------------------------- #

def usage_summary(conn: sqlite3.Connection, sid: str) -> dict:
    r = _row(
        conn,
        """SELECT COUNT(*) n_calls,
                  COALESCE(SUM(input_tokens),0) input_tokens,
                  COALESCE(SUM(output_tokens),0) output_tokens,
                  COALESCE(SUM(cache_read),0) cache_read,
                  COALESCE(SUM(cache_write),0) cache_write,
                  COALESCE(SUM(cost_usd),0) cost_usd
             FROM transcripts WHERE session_id=?""",
        (sid,),
    )
    return r or {}


def cost_by_agent(conn: sqlite3.Connection, sid: str) -> list[dict]:
    return _rows(
        conn,
        """SELECT agent,
                  COUNT(*) n_calls,
                  COALESCE(SUM(input_tokens),0) input_tokens,
                  COALESCE(SUM(output_tokens),0) output_tokens,
                  COALESCE(SUM(cost_usd),0) cost_usd
             FROM transcripts WHERE session_id=?
             GROUP BY agent ORDER BY cost_usd DESC""",
        (sid,),
    )


def list_transcripts(conn: sqlite3.Connection, sid: str, limit: int = 200) -> list[dict]:
    return _rows(
        conn,
        """SELECT id, agent, action, model, input_tokens, output_tokens,
                  cache_read, cache_write, cost_usd, started_at, finished_at
             FROM transcripts WHERE session_id=?
             ORDER BY started_at DESC LIMIT ?""",
        (sid, limit),
    )


# --------------------------------------------------------------------------- #
# Feedback / events
# --------------------------------------------------------------------------- #

def list_feedback(conn: sqlite3.Connection, sid: str) -> list[dict]:
    return _rows(
        conn,
        "SELECT * FROM system_feedback WHERE session_id=? ORDER BY created_at DESC",
        (sid,),
    )


def insert_chat(conn: sqlite3.Connection, sid: str, role: str, text: str, *,
                intent: str | None = None, new_session_id: str | None = None) -> str:
    cid = "chat_" + hashlib.sha256(f"{sid}{role}{text}{time.time()}".encode()).hexdigest()[:16]
    conn.execute(
        """INSERT INTO chat_messages
               (id, session_id, created_at, role, intent, text, new_session_id)
           VALUES (?,?,?,?,?,?,?)""",
        (cid, sid, datetime.now(UTC).isoformat(), role, intent, text, new_session_id),
    )
    conn.commit()
    return cid


def list_chat(conn: sqlite3.Connection, sid: str) -> list[dict]:
    return _rows(
        conn,
        """SELECT id, session_id, created_at, role, intent, text, new_session_id
             FROM chat_messages WHERE session_id=?
            ORDER BY created_at ASC, rowid ASC""",
        (sid,),
    )


def recent_events(conn: sqlite3.Connection, sid: str, after_id: int = 0,
                  limit: int = 200) -> list[dict]:
    rows = _rows(
        conn,
        """SELECT id, ts, agent, event, payload
             FROM events
            WHERE session_id=? AND id > ?
            ORDER BY id ASC LIMIT ?""",
        (sid, after_id, limit),
    )
    for r in rows:
        r["payload"] = _loads(r.get("payload"), {})
    return rows


def metrics(conn: sqlite3.Connection, sid: str) -> dict:
    u = usage_summary(conn, sid)
    counts = session_counts(conn, sid)
    hs = counts["hypothesis_states"]
    n_matches = _row(
        conn, "SELECT COUNT(*) n FROM tournament_matches WHERE session_id=?", (sid,)
    )["n"]
    n_invalid = _row(
        conn,
        "SELECT COUNT(*) n FROM tournament_matches WHERE session_id=? AND mode='invalid'",
        (sid,),
    )["n"]
    cache_total = (u.get("cache_read") or 0) + (u.get("cache_write") or 0)
    denom = (u.get("input_tokens") or 0) + cache_total
    return {
        **u,
        "n_matches": n_matches,
        "n_invalid_matches": n_invalid,
        "n_hypotheses": sum(hs.values()),
        "n_in_tournament": hs.get("in_tournament", 0) + hs.get("pinned", 0),
        "n_reviewed": hs.get("reviewed", 0) + hs.get("in_tournament", 0)
        + hs.get("pinned", 0),
        "n_pinned": hs.get("pinned", 0),
        "n_rejected": hs.get("rejected", 0),
        "cache_hit_ratio": (u.get("cache_read") or 0) / denom if denom else None,
    }


# --------------------------------------------------------------------------- #
# New-feature views: lineage graph + proximity clusters
# --------------------------------------------------------------------------- #

def lineage(conn: sqlite3.Connection, sid: str) -> dict:
    hyps = _rows(
        conn,
        """SELECT id, title, strategy, created_by, parent_ids, elo, state, created_at
             FROM hypotheses WHERE session_id=? ORDER BY created_at ASC""",
        (sid,),
    )
    nodes, edges = [], []
    ids = {h["id"] for h in hyps}
    for h in hyps:
        parents = _loads(h.get("parent_ids"), [])
        nodes.append({
            "id": h["id"], "title": h["title"], "strategy": h["strategy"],
            "created_by": h["created_by"], "elo": h["elo"], "state": h["state"],
            "n_parents": len(parents),
        })
        for p in parents:
            if p in ids:
                edges.append({"source": p, "target": h["id"]})
    return {"nodes": nodes, "edges": edges}


def clusters(conn: sqlite3.Connection, sid: str) -> list[dict]:
    """2D layout for the proximity map.

    Real embeddings live in FAISS on disk; for the browsable view we derive a
    deterministic pseudo-projection grouped by `dedup_cluster` so semantically
    grouped hypotheses sit together. Stable across reloads (hash of id).
    """
    import hashlib
    import math

    hyps = _rows(
        conn,
        """SELECT id, title, strategy, elo, state, dedup_cluster, matches_played
             FROM hypotheses WHERE session_id=?""",
        (sid,),
    )
    cluster_ids = sorted({h["dedup_cluster"] or "_solo_" for h in hyps})
    centers: dict[str, tuple[float, float]] = {}
    n = max(len(cluster_ids), 1)
    for i, c in enumerate(cluster_ids):
        ang = 2 * math.pi * i / n
        centers[c] = (math.cos(ang) * 0.62, math.sin(ang) * 0.62)
    out = []
    for h in hyps:
        c = h["dedup_cluster"] or "_solo_"
        cx, cy = centers[c]
        seed = int(hashlib.sha256(h["id"].encode()).hexdigest(), 16)
        jx = ((seed % 1000) / 1000 - 0.5) * 0.34
        jy = (((seed // 1000) % 1000) / 1000 - 0.5) * 0.34
        out.append({
            "id": h["id"], "title": h["title"], "strategy": h["strategy"],
            "elo": h["elo"], "state": h["state"], "cluster": c,
            "matches_played": h["matches_played"],
            "x": cx + jx, "y": cy + jy,
        })
    return out


# --------------------------------------------------------------------------- #
# Global stats (dashboard)
# --------------------------------------------------------------------------- #

def global_stats(conn: sqlite3.Connection) -> dict:
    s = _row(
        conn,
        """SELECT COUNT(*) n_sessions,
                  COALESCE(SUM(budget_used_usd),0) total_cost,
                  SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) running,
                  SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) done
             FROM sessions""",
    )
    h = _row(conn, "SELECT COUNT(*) n FROM hypotheses")
    m = _row(conn, "SELECT COUNT(*) n FROM tournament_matches")
    return {
        "n_sessions": s["n_sessions"],
        "n_hypotheses": h["n"],
        "n_matches": m["n"],
        "total_cost_usd": s["total_cost"],
        "running": s["running"] or 0,
        "done": s["done"] or 0,
    }
