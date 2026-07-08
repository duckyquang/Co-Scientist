"""Live, key-free session simulator.

When a user starts a session from the web UI and no real LLM engine is wired
in (the common demo case), this drives the session forward in real time:
generation -> reflection -> ranking (Elo) -> evolution -> meta-review, emitting
the same events the real Supervisor would, so the live activity feed, leaderboard
and gauges all animate. Each session runs in its own daemon thread.
"""

from __future__ import annotations

import hashlib
import json
import random
import threading
import time
from datetime import UTC, datetime, timedelta

from . import content
from .seed import EXTRA_TABLES, _elo_update, _emit, _transcript
from .store import REPO_ROOT, connect

_RUNNING: dict[str, "Sim"] = {}
_LOCK = threading.Lock()


def _now() -> datetime:
    return datetime.now(UTC)


def _ts(dt: datetime) -> str:
    return dt.isoformat()


class Sim:
    def __init__(self, db, sid: str, goal: str, budget: float, n_initial: int, speed: float):
        self.db = db
        self.sid = sid
        self.goal = goal
        self.budget = budget
        self.n_initial = n_initial
        self.speed = speed  # seconds multiplier (lower = faster)
        self.r = random.Random(sid)
        self.cost = 0.0
        self.hyps: list[dict] = []

    # control --------------------------------------------------------------
    def _status(self, conn) -> str:
        row = conn.execute("SELECT status FROM sessions WHERE id=?", (self.sid,)).fetchone()
        return row[0] if row else "aborted"

    def _wait(self, conn, seconds: float) -> bool:
        """Sleep, honoring pause/abort. Returns False if the run should stop."""
        deadline = time.time() + seconds * self.speed
        while time.time() < deadline:
            st = self._status(conn)
            if st in ("aborted", "failed"):
                return False
            if st == "paused":
                deadline += 0.5  # extend while paused
            time.sleep(0.2)
        return self._status(conn) not in ("aborted", "failed")

    def _bump(self, conn, add_cost: float):
        self.cost += add_cost
        conn.execute(
            "UPDATE sessions SET budget_used_usd=?, budget_used_tokens=?, updated_at=? WHERE id=?",
            (round(self.cost, 4), int(self.cost * 220_000), _ts(_now()), self.sid),
        )
        conn.commit()

    # phases ---------------------------------------------------------------
    def run(self):
        conn = connect(self.db)
        conn.executescript(EXTRA_TABLES)
        try:
            self._generation(conn)
            if self._status(conn) in ("aborted", "failed"):
                return
            self._ranking(conn, rounds=2)
            self._evolution(conn)
            self._ranking(conn, rounds=2)
            self._finalize(conn)
        except Exception as e:  # keep the thread from dying silently
            _emit(conn, self.sid, "supervisor", "task_failed",
                  {"err": str(e)[:300]}, _now())
            conn.commit()
        finally:
            conn.close()
            with _LOCK:
                _RUNNING.pop(self.sid, None)

    def _add_hyp(self, conn, i, strat, created_by, parents):
        c = content.make_hypothesis(self.goal, i, strat)
        hid = "hyp_" + hashlib.sha256(f"{self.sid}|{i}".encode()).hexdigest()[:18]
        now = _now()
        conn.execute(
            """INSERT INTO hypotheses
               (id, session_id, created_at, created_by, strategy, parent_ids,
                title, summary, full_text, artifact_path, elo, matches_played,
                state, dedup_cluster)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (hid, self.sid, _ts(now), created_by, strat, json.dumps(parents),
             c["title"], c["summary"], c["full_text"], f"hypotheses/{hid}.json",
             None, 0, "draft", f"clu_{i % max(2, self.n_initial // 2)}"),
        )
        for cit in c["citations"]:
            conn.execute(
                "INSERT INTO web_citations (hypothesis_id, title, url, excerpt, doi, year)"
                " VALUES (?,?,?,?,?,?)",
                (hid, cit["title"], cit["url"], cit["excerpt"], cit["doi"], cit["year"]))
        cost = round(self.r.uniform(0.04, 0.2), 4)
        _transcript(conn, self.sid, created_by, f"{created_by}.{strat}",
                    content.MODELS[created_by], now, cost)
        _emit(conn, self.sid, created_by, "hypothesis_created",
              {"hypothesis_id": hid, "title": c["title"][:80], "strategy": strat}, now)
        self._bump(conn, cost)
        h = {"id": hid, "title": c["title"], "summary": c["summary"], "elo": 1200.0,
             "matches": 0, "strategy": strat}
        self.hyps.append(h)
        return h

    def _review(self, conn, h):
        now = _now()
        rv = content.make_review(self.goal, h["title"], "full")
        rid = "rev_" + hashlib.sha256(f"{h['id']}full".encode()).hexdigest()[:16]
        conn.execute(
            """INSERT INTO reviews
               (id, hypothesis_id, session_id, created_at, kind, verdict,
                novelty, correctness, testability, feasibility, body, artifact_path)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (rid, h["id"], self.sid, _ts(now), "full", rv["verdict"],
             rv["scores"]["novelty"], rv["scores"]["correctness"],
             rv["scores"]["testability"], rv["scores"]["feasibility"],
             rv["body"], f"reviews/{rid}.json"))
        conn.execute("UPDATE hypotheses SET state='reviewed' WHERE id=?", (h["id"],))
        cost = round(self.r.uniform(0.03, 0.1), 4)
        _transcript(conn, self.sid, "reflection", "reflection.full",
                    content.MODELS["reflection"], now, cost)
        _emit(conn, self.sid, "reflection", "review_completed",
              {"hypothesis_id": h["id"], "kind": "full"}, now)
        self._bump(conn, cost)

    def _generation(self, conn):
        _emit(conn, self.sid, "generation", "task_started",
              {"agent": "generation", "action": "CreateInitialHypotheses"}, _now())
        for i in range(self.n_initial):
            if not self._wait(conn, 2.5):
                return
            h = self._add_hyp(conn, i, content.STRATEGIES[i % 3], "generation", [])
            if not self._wait(conn, 1.5):
                return
            self._review(conn, h)
            conn.execute("UPDATE hypotheses SET state='in_tournament', elo=1200 WHERE id=?",
                         (h["id"],))
            conn.commit()

    def _ranking(self, conn, rounds: int):
        for _r in range(rounds):
            pool = list(self.hyps)
            self.r.shuffle(pool)
            for a, b in zip(pool[::2], pool[1::2]):
                if a is b or not self._wait(conn, 1.2):
                    return
                mode = "debate" if self.r.random() < 0.35 else "pairwise"
                winner = "a" if self.r.random() < 0.5 else "b"
                ra, rb = _elo_update(a["elo"], b["elo"], winner)
                mid = "mat_" + hashlib.sha256(
                    f"{self.sid}{a['id']}{b['id']}{time.time()}".encode()).hexdigest()[:16]
                now = _now()
                conn.execute(
                    """INSERT INTO tournament_matches
                       (id, session_id, created_at, hyp_a, hyp_b, mode, winner,
                        elo_a_before, elo_b_before, elo_a_after, elo_b_after,
                        rationale, transcript_id, similarity)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (mid, self.sid, _ts(now), a["id"], b["id"], mode, winner,
                     a["elo"], b["elo"], ra, rb,
                     f"Idea {winner.upper()} gave a sharper falsification criterion.",
                     None, round(self.r.uniform(0.05, 0.4), 2)))
                conn.execute(
                    """INSERT OR IGNORE INTO elo_journal
                       (update_id, match_id, hyp_a, hyp_b, winner, elo_a_before,
                        elo_b_before, elo_a_after, elo_b_after, applied_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (mid, mid, a["id"], b["id"], winner, a["elo"], b["elo"], ra, rb,
                     int(now.timestamp() * 1000)))
                a["elo"], b["elo"] = ra, rb
                a["matches"] += 1
                b["matches"] += 1
                for hh in (a, b):
                    conn.execute("UPDATE hypotheses SET elo=?, matches_played=? WHERE id=?",
                                 (hh["elo"], hh["matches"], hh["id"]))
                cost = round(self.r.uniform(0.01, 0.05), 4)
                _transcript(conn, self.sid, "ranking", f"ranking.{mode}",
                            content.MODELS["ranking"], now, cost)
                _emit(conn, self.sid, "ranking", "match_complete",
                      {"match_id": mid, "winner": winner, "mode": mode}, now)
                self._bump(conn, cost)

    def _evolution(self, conn):
        if not self.hyps or not self._wait(conn, 1.0):
            return
        top = sorted(self.hyps, key=lambda h: -h["elo"])[:3]
        _emit(conn, self.sid, "evolution", "task_started",
              {"agent": "evolution", "action": "EvolveTopHypotheses"}, _now())
        for j, strat in enumerate(["combine", "out_of_box"]):
            if not self._wait(conn, 2.0):
                return
            parents = [top[0]["id"]] + ([top[1]["id"]] if strat == "combine" and len(top) > 1 else [])
            h = self._add_hyp(conn, self.n_initial + j, strat, "evolution", parents)
            self._review(conn, h)
            conn.execute("UPDATE hypotheses SET state='in_tournament', elo=1200 WHERE id=?",
                         (h["id"],))
            conn.commit()

    def _finalize(self, conn):
        if self._status(conn) in ("aborted", "failed"):
            return
        top = sorted(self.hyps, key=lambda h: -h["elo"])
        if top:
            conn.execute("UPDATE hypotheses SET state='pinned' WHERE id=?", (top[0]["id"],))
        # meta-review feedback
        conn.execute(
            "INSERT INTO system_feedback (id, session_id, created_at, source, kind,"
            " target_id, text, active) VALUES (?,?,?,?,?,?,?,1)",
            ("fb_" + hashlib.sha256(f"{self.sid}fb".encode()).hexdigest()[:12], self.sid,
             _ts(_now()), "meta_review", "system_feedback", None,
             "Top candidates converge on a shared pathway — a robust signal. Consider "
             "one more out-of-box round to stress-test the consensus."))
        ov_md = content.make_overview(self.goal, top[:5])
        ov_dir = REPO_ROOT / "data" / "artifacts" / self.sid / "final"
        ov_dir.mkdir(parents=True, exist_ok=True)
        (ov_dir / "overview.md").write_text(ov_md)
        cost = round(self.r.uniform(0.05, 0.15), 4)
        _transcript(conn, self.sid, "metareview", "metareview.final",
                    content.MODELS["metareview"], _now(), cost)
        self._bump(conn, cost)
        conn.execute(
            "UPDATE sessions SET status='done', final_overview=?, updated_at=? WHERE id=?",
            (f"artifacts/{self.sid}/final/overview.md", _ts(_now()), self.sid))
        _emit(conn, self.sid, "metareview", "session_done", {"stop_reason": "ELO_STABLE"}, _now())
        conn.commit()


def start(db, sid: str, goal: str, budget: float, n_initial: int = 4,
          speed: float = 1.0) -> None:
    sim = Sim(db, sid, goal, budget, n_initial, speed)
    with _LOCK:
        _RUNNING[sid] = sim
    threading.Thread(target=sim.run, name=f"sim-{sid[:8]}", daemon=True).start()


def is_running(sid: str) -> bool:
    with _LOCK:
        return sid in _RUNNING
