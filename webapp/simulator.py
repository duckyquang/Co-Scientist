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

TOKENS_PER_USD = 220_000
# Reasoning spends the budget in two stages. The self-critique loop fills to
# (util_target - CRITIQUE_GAP); the stress-test stage then tops it up to the
# per-session util_target (seeded in UTIL_RANGE so finished runs land at
# *varied* 90-99% utilization instead of a fixed 95%), never >100%.
UTIL_RANGE = (0.90, 0.99)
CRITIQUE_GAP = 0.10
# Each critique round burns ~this fraction of the budget, so the number of
# rounds stays bounded (~3-5) regardless of budget size → wall time stays sane.
CRITIQUE_ROUND_FRACTION = 0.22
MAX_CRITIQUE_ROUNDS = 8
# Token chunk each stress-test report spends (budget-scaled, clamped to the
# util_target). 3 tested hyps x this comfortably covers the critique->util gap.
STRESS_TEST_FRACTION = 0.05
# Initial Elo seeding: each fabricated hypothesis has a hidden quality
# q ∈ [0.05, 0.95] (deterministic per hyp id) → Elo = BASE + SPAN*q + noise,
# mirroring the real engine's review-composite seeding (1000..1800).
ELO_SEED_BASE = 1000.0
ELO_SEED_SPAN = 800.0

# Varied match rationales so the tournament feed doesn't repeat one sentence.
_MATCH_RATIONALES = [
    "gave a sharper falsification criterion",
    "offered a cleaner causal mechanism",
    "proposed a more decisive experiment",
    "held up better under cross-examination",
    "rested on stronger, more direct evidence",
    "made a more specific, testable claim",
]


def _now() -> datetime:
    return datetime.now(UTC)


def _ts(dt: datetime) -> str:
    return dt.isoformat()


class Sim:
    def __init__(self, db, sid: str, goal: str, budget: float, n_initial: int,
                 speed: float, budget_tokens: int = 5_000_000):
        self.db = db
        self.sid = sid
        self.goal = goal
        self.budget = budget
        self.budget_tokens = max(1, int(budget_tokens))
        self.n_initial = n_initial
        self.speed = speed  # seconds multiplier (lower = faster)
        self.r = random.Random(sid)
        # Per-session utilization target: finished runs read 90-99%, varied.
        self.util_target = random.Random(f"{sid}|util").uniform(*UTIL_RANGE)
        self.cost = 0.0
        self.tokens = 0.0  # simulated cumulative tokens (drives the budget gauge)
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

    def _bump(self, conn, add_cost: float, add_tokens: int | None = None):
        self.cost += add_cost
        self.tokens += add_tokens if add_tokens is not None else add_cost * TOKENS_PER_USD
        conn.execute(
            "UPDATE sessions SET budget_used_usd=?, budget_used_tokens=?, updated_at=? WHERE id=?",
            # Cap the gauge at the per-session util_target (90-99%): incidental
            # match/review/finalize tokens always overshoot it, so a finished run
            # reads exactly its varied target instead of pinning at a fixed value.
            (round(self.cost, 4),
             min(int(self.tokens), int(self.budget_tokens * self.util_target)),
             _ts(_now()), self.sid),
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
            self._evolution(conn)  # round 1: breed from the current leaders
            self._ranking(conn, rounds=1)
            self._evolution(conn)  # round 2: parents = top AFTER the re-rank
            self._ranking(conn, rounds=2)
            self._self_critique_rounds(conn)
            self._stress_test_rounds(conn)
            self._finalize(conn)
        except Exception as e:  # keep the thread from dying silently
            _emit(conn, self.sid, "supervisor", "task_failed",
                  {"err": str(e)[:300]}, _now())
            conn.commit()
        finally:
            conn.close()
            with _LOCK:
                _RUNNING.pop(self.sid, None)

    def _seed_elo(self, hid: str, i: int, n: int) -> float:
        """Quality-seeded initial Elo (1000..1800 + noise), deterministic per hyp.

        Quality is stratified across the batch by index (with per-id jitter) so
        the initial seeds reliably span the range — independent draws over a
        small batch occasionally cluster and would leave the spread too narrow.
        """
        rq = random.Random(f"{hid}|q")
        frac = min(1.0, max(0.0, (i + rq.uniform(-0.4, 0.4)) / max(1, n - 1)))
        q = 0.05 + 0.90 * frac
        return round(ELO_SEED_BASE + ELO_SEED_SPAN * q + rq.uniform(-15, 15), 1)

    @staticmethod
    def _p_win_a(a, b) -> float:
        """Win probability from each idea's fixed quality anchor (seed Elo).

        Anchoring on the seed rather than the drifting live Elo keeps the
        favourite winning at a constant rate, so consistent winners climb toward
        2000 and losers fall toward 1000 instead of mean-reverting — which is
        what widens the leaderboard into the 1000-2000 band.
        """
        return 1.0 / (1.0 + 10 ** ((b["elo0"] - a["elo0"]) / 400.0))

    def _add_hyp(self, conn, i, strat, created_by, parents):
        c = content.make_hypothesis(self.goal, i, strat)
        hid = "hyp_" + hashlib.sha256(f"{self.sid}|{i}".encode()).hexdigest()[:18]
        now = _now()
        # Evolution children inherit their best parent's quality plus a small
        # boost; fresh generations get a hidden seeded quality.
        parent_elos = [h["elo"] for h in self.hyps if h["id"] in parents]
        seed_elo = (round(max(parent_elos) + self.r.uniform(10, 40), 1)
                    if parent_elos else self._seed_elo(hid, i, self.n_initial))
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
        conn.execute(
            "INSERT OR REPLACE INTO hyp_thinking (hypothesis_id, thinking) VALUES (?,?)",
            (hid, c.get("thinking", "")))
        cost = round(self.r.uniform(0.04, 0.2), 4)
        _transcript(conn, self.sid, created_by, f"{created_by}.{strat}",
                    content.MODELS[created_by], now, cost)
        _emit(conn, self.sid, created_by, "hypothesis_created",
              {"hypothesis_id": hid, "title": c["title"][:80], "strategy": strat}, now)
        self._bump(conn, cost)
        h = {"id": hid, "title": c["title"], "summary": c["summary"], "elo": seed_elo,
             "elo0": seed_elo,  # fixed quality anchor for match outcomes
             "matches": 0, "strategy": strat, "citations": c["citations"],
             "parent_ids": list(parents)}  # consumed by the overview's lineage figure
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
            conn.execute("UPDATE hypotheses SET state='in_tournament', elo=? WHERE id=?",
                         (h["elo"], h["id"]))
            conn.commit()

    def _apply_match(self, conn, a, b, mode: str, winner: str, k: int = 48):
        """Record one tournament match: Elo update, match + journal rows,
        transcript, event and a small cost bump. Shared by the main ranking
        phase and the self-critique re-rank bursts."""
        ra, rb = _elo_update(a["elo"], b["elo"], winner, k=k)
        mid = "mat_" + hashlib.sha256(
            f"{self.sid}{a['id']}{b['id']}{time.time()}".encode()).hexdigest()[:16]
        now = _now()
        rationale = (
            f"Idea {winner.upper()} {self.r.choice(_MATCH_RATIONALES)}."
        )
        conn.execute(
            """INSERT INTO tournament_matches
               (id, session_id, created_at, hyp_a, hyp_b, mode, winner,
                elo_a_before, elo_b_before, elo_a_after, elo_b_after,
                rationale, transcript_id, similarity)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (mid, self.sid, _ts(now), a["id"], b["id"], mode, winner,
             a["elo"], b["elo"], ra, rb, rationale,
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

    def _ranking(self, conn, rounds: int):
        for _r in range(rounds):
            pool = list(self.hyps)
            self.r.shuffle(pool)
            for a, b in zip(pool[::2], pool[1::2]):
                if a is b or not self._wait(conn, 1.2):
                    return
                mode = "debate" if self.r.random() < 0.35 else "pairwise"
                winner = "a" if self.r.random() < self._p_win_a(a, b) else "b"
                self._apply_match(conn, a, b, mode, winner)

    def _evolution(self, conn):
        """One evolution round: breed 2 offspring from the CURRENT top-ranked
        parents. Called between ranking phases, so each round's parents (and
        created_at cluster — the chat groups offspring into rounds by timestamp
        gaps) reflect the standings at that moment."""
        # 3.0 pre-round wait: widens the created_at gap between rounds so the
        # chat's round clustering stays unambiguous even at high sim speeds.
        if not self.hyps or not self._wait(conn, 3.0):
            return
        top = sorted(self.hyps, key=lambda h: -h["elo"])[:3]
        _emit(conn, self.sid, "evolution", "task_started",
              {"agent": "evolution", "action": "EvolveTopHypotheses"}, _now())
        idx0 = len(self.hyps)  # unique hyp-id index base across rounds
        for j, strat in enumerate(["combine", "out_of_box"]):
            if not self._wait(conn, 2.0):
                return
            parents = [top[0]["id"]] + ([top[1]["id"]] if strat == "combine" and len(top) > 1 else [])
            h = self._add_hyp(conn, idx0 + j, strat, "evolution", parents)
            self._review(conn, h)
            conn.execute("UPDATE hypotheses SET state='in_tournament', elo=? WHERE id=?",
                         (h["elo"], h["id"]))
            conn.commit()

    def _self_critique_rounds(self, conn):
        """Keep reasoning past the standard phases: each round writes a
        meta-review self-critique (re-questioning the leaders), then runs a short
        low-K re-rank burst that wobbles Elo without churning the order — looping
        until the simulated token spend reaches util_target - CRITIQUE_GAP of the
        budget (the stress-test stage then tops it up to util_target)."""
        target = int((self.util_target - CRITIQUE_GAP) * self.budget_tokens)
        per_round = max(1, int(CRITIQUE_ROUND_FRACTION * self.budget_tokens))
        round_no = 0
        while self.tokens < target and round_no < MAX_CRITIQUE_ROUNDS:
            if self._status(conn) in ("aborted", "failed") or not self._wait(conn, 1.5):
                return
            round_no += 1
            top = sorted(self.hyps, key=lambda h: -h["elo"])
            now = _now()
            text = content.make_self_critique(self.goal, round_no, top)
            fid = "fb_" + hashlib.sha256(f"{self.sid}sc{round_no}".encode()).hexdigest()[:12]
            conn.execute(
                "INSERT INTO system_feedback (id, session_id, created_at, source,"
                " kind, target_id, text, active) VALUES (?,?,?,?,?,?,?,1)",
                (fid, self.sid, _ts(now), "meta_review", "self_critique", None, text))
            # Big, budget-scaled token chunk (clamped so critique never crosses
            # the target), priced at the standard token/USD rate for consistency.
            add_tokens = min(per_round, max(0, target - int(self.tokens)))
            cost = round(add_tokens / TOKENS_PER_USD, 4)
            _transcript(conn, self.sid, "metareview", "metareview.self_critique",
                        content.MODELS["metareview"], now, cost)
            _emit(conn, self.sid, "metareview", "task_completed",
                  {"agent": "metareview", "kind": "self_critique",
                   "round": round_no, "action": "SelfCritique"}, now)
            self._bump(conn, cost, add_tokens)
            # Short re-rank burst: 2 low-K matches so Elo jiggles but the wide
            # gaps from the main tournament keep the ordering stable.
            for _ in range(2):
                if len(self.hyps) < 2 or not self._wait(conn, 0.8):
                    break
                a, b = self.r.sample(self.hyps, 2)
                winner = "a" if self.r.random() < self._p_win_a(a, b) else "b"
                self._apply_match(conn, a, b, "pairwise", winner, k=6)

    def _stress_review(self, conn, h):
        """A reviews row with kind='stress_test' for a tested hyp (mirrors the
        `_review` INSERT so the hypothesis detail shows the stress verdict)."""
        now = _now()
        rv = content.make_review(self.goal, h["title"], "full")
        rid = "rev_" + hashlib.sha256(f"{h['id']}stress".encode()).hexdigest()[:16]
        conn.execute(
            """INSERT INTO reviews
               (id, hypothesis_id, session_id, created_at, kind, verdict,
                novelty, correctness, testability, feasibility, body, artifact_path)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (rid, h["id"], self.sid, _ts(now), "stress_test", rv["verdict"],
             rv["scores"]["novelty"], rv["scores"]["correctness"],
             rv["scores"]["testability"], rv["scores"]["feasibility"],
             rv["body"], f"reviews/{rid}.json"))

    def _add_fix_child(self, conn, i, parent, fix):
        """Insert a stress-hardened fix child (strategy feedback_driven, created
        by evolution, parent = the tested hyp) seeded just above its parent's Elo
        so a short re-rank generally leaves it on top. Returns the hyp dict."""
        hid = "hyp_" + hashlib.sha256(f"{self.sid}|fix|{parent['id']}".encode()).hexdigest()[:18]
        now = _now()
        # Inherit parent quality + a small boost so hardened ideas rank high.
        start_elo = round(parent["elo"] + self.r.uniform(10, 30), 1)
        full_text = (
            f"## Hardening\n\n{fix['summary']}\n\nThis is a stress-hardened "
            f"revision of *{parent['title']}*, addressing the failure mode the "
            f"stress test surfaced before any scale-up.")
        conn.execute(
            """INSERT INTO hypotheses
               (id, session_id, created_at, created_by, strategy, parent_ids,
                title, summary, full_text, artifact_path, elo, matches_played,
                state, dedup_cluster)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (hid, self.sid, _ts(now), "evolution", "feedback_driven",
             json.dumps([parent["id"]]), fix["title"], fix["summary"], full_text,
             f"hypotheses/{hid}.json", start_elo, 0, "draft",
             f"clu_{i % max(2, self.n_initial // 2)}"))
        for cit in parent["citations"]:
            conn.execute(
                "INSERT INTO web_citations (hypothesis_id, title, url, excerpt, doi, year)"
                " VALUES (?,?,?,?,?,?)",
                (hid, cit["title"], cit["url"], cit["excerpt"], cit["doi"], cit["year"]))
        conn.execute(
            "INSERT OR REPLACE INTO hyp_thinking (hypothesis_id, thinking) VALUES (?,?)",
            (hid, fix.get("thinking", "")))
        cost = round(self.r.uniform(0.04, 0.2), 4)
        _transcript(conn, self.sid, "evolution", "evolution.feedback_driven",
                    content.MODELS["evolution"], now, cost)
        _emit(conn, self.sid, "evolution", "hypothesis_created",
              {"hypothesis_id": hid, "title": fix["title"][:80],
               "strategy": "feedback_driven"}, now)
        self._bump(conn, cost)
        h = {"id": hid, "title": fix["title"], "summary": fix["summary"],
             "elo": start_elo, "elo0": start_elo, "matches": 0,
             "strategy": "feedback_driven", "citations": parent["citations"],
             "parent_ids": [parent["id"]]}
        self.hyps.append(h)
        return h

    def _stress_test_rounds(self, conn):
        """Fabricated stress-test stage (mimics the real engine's stage so the
        demo shows the full workflow): take the top-3 leaders, write a meta-review
        stress report + review for each, breed a hardened fix child, then a short
        re-rank burst so the fixes generally overtake their parents, and finish
        with a stress_ranking summary. Tops token spend from the critique level
        up to the per-session util_target."""
        if self._status(conn) in ("aborted", "failed") or len(self.hyps) < 2:
            return
        top3 = sorted(self.hyps, key=lambda h: -h["elo"])[:3]
        stress_target = int(self.util_target * self.budget_tokens)
        per_hyp = max(1, int(STRESS_TEST_FRACTION * self.budget_tokens))
        idx0 = len(self.hyps)  # next free hyp-id index (after all evolution rounds)
        pairs: list[tuple[dict, dict]] = []
        for k, h in enumerate(top3):
            if self._status(conn) in ("aborted", "failed") or not self._wait(conn, 1.5):
                return
            now = _now()
            _emit(conn, self.sid, "stresstest", "task_started",
                  {"agent": "stresstest", "action": "StressTest",
                   "hypothesis_id": h["id"]}, now)
            report = content.make_stress_report(
                self.goal, h, {"round": k + 1, "of": len(top3)})
            fid = "fb_" + hashlib.sha256(f"{self.sid}st{k}".encode()).hexdigest()[:12]
            conn.execute(
                "INSERT INTO system_feedback (id, session_id, created_at, source,"
                " kind, target_id, text, active) VALUES (?,?,?,?,?,?,?,1)",
                (fid, self.sid, _ts(now), "meta_review", "stress_test", h["id"], report))
            self._stress_review(conn, h)
            add_tokens = min(per_hyp, max(0, stress_target - int(self.tokens)))
            cost = round(add_tokens / TOKENS_PER_USD, 4)
            _transcript(conn, self.sid, "stresstest", "stresstest.report",
                        content.MODELS["metareview"], now, cost)
            _emit(conn, self.sid, "stresstest", "task_completed",
                  {"agent": "stresstest", "kind": "stress_test",
                   "hypothesis_id": h["id"], "action": "StressTest"}, now)
            self._bump(conn, cost, add_tokens)
            child = self._add_fix_child(conn, idx0 + k, h, content.make_stress_fix(h))
            self._review(conn, child)
            conn.execute("UPDATE hypotheses SET state='in_tournament' WHERE id=?",
                         (child["id"],))
            conn.commit()
            pairs.append((h, child))
        # Short re-rank burst: 2 random wobble matches (low K) first, then each
        # child beats its parent (higher K) so the fixes end up on top.
        for _ in range(2):
            if len(self.hyps) < 2 or not self._wait(conn, 0.8):
                break
            a, b = self.r.sample(self.hyps, 2)
            winner = "a" if self.r.random() < self._p_win_a(a, b) else "b"
            self._apply_match(conn, a, b, "pairwise", winner, k=6)
        for parent, child in pairs:
            if not self._wait(conn, 0.8):
                break
            self._apply_match(conn, child, parent, "pairwise", "a", k=16)
        # stress_ranking summary row, ordered by the fix children's final Elo.
        ranked = sorted(
            ({"tested": p, "fix": c, "elo": c["elo"], "parent_elo": p["elo"]}
             for p, c in pairs),
            key=lambda e: -e["elo"])
        text = content.make_stress_ranking(self.goal, ranked)
        conn.execute(
            "INSERT INTO system_feedback (id, session_id, created_at, source,"
            " kind, target_id, text, active) VALUES (?,?,?,?,?,?,?,1)",
            ("fb_" + hashlib.sha256(f"{self.sid}strank".encode()).hexdigest()[:12],
             self.sid, _ts(_now()), "meta_review", "stress_ranking", None, text))
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
        ov_md = content.make_overview(self.goal, top[:3])
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
        _emit(conn, self.sid, "metareview", "session_done", {"stop_reason": "BUDGET"}, _now())
        conn.commit()


def start(db, sid: str, goal: str, budget: float, n_initial: int = 4,
          speed: float = 1.0, budget_tokens: int = 5_000_000) -> None:
    sim = Sim(db, sid, goal, budget, n_initial, speed, budget_tokens=budget_tokens)
    with _LOCK:
        _RUNNING[sid] = sim
    threading.Thread(target=sim.run, name=f"sim-{sid[:8]}", daemon=True).start()


def is_running(sid: str) -> bool:
    with _LOCK:
        return sid in _RUNNING
