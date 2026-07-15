"""Seed a demo SQLite DB so the website is fully explorable without API keys.

Run:  python -m webapp.seed            (seeds the default data/co_scientist.db)
      python -m webapp.seed --reset    (wipe demo rows first)

Writes rows matching the real engine's schema, so the same DB also accepts
output from `co-scientist run`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import sqlite3
from datetime import UTC, datetime, timedelta

from . import content
from .store import DEFAULT_DB, connect

EXTRA_TABLES = """
CREATE TABLE IF NOT EXISTS web_citations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    hypothesis_id TEXT NOT NULL,
    title         TEXT, url TEXT, excerpt TEXT, doi TEXT, year INTEGER
);
CREATE INDEX IF NOT EXISTS web_cit_hyp ON web_citations(hypothesis_id);

CREATE TABLE IF NOT EXISTS chat_messages (
    id             TEXT PRIMARY KEY,
    session_id     TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    role           TEXT NOT NULL,          -- 'user' | 'assistant'
    intent         TEXT,                   -- null for user rows
    text           TEXT NOT NULL,
    new_session_id TEXT                    -- set on assistant tweak rows
);
CREATE INDEX IF NOT EXISTS chat_msg_session ON chat_messages(session_id, created_at);
"""

DEMO_TAG = "demo::"  # session ids are prefixed so --reset only nukes demo data


def _ts(dt: datetime) -> str:
    return dt.isoformat()


def _sid(label: str) -> str:
    return DEMO_TAG + hashlib.sha256(label.encode()).hexdigest()[:16]


def _hid(sid: str, n: int) -> str:
    return "hyp_" + hashlib.sha256(f"{sid}|{n}".encode()).hexdigest()[:18]


def _elo_update(ra: float, rb: float, winner: str, k: int = 48) -> tuple[float, float]:
    ea = 1 / (1 + 10 ** ((rb - ra) / 400))
    sa = 1.0 if winner == "a" else 0.0
    ra2 = ra + k * (sa - ea)
    rb2 = rb + k * ((1 - sa) - (1 - ea))
    return round(ra2, 1), round(rb2, 1)


def _emit(conn, sid, agent, event, payload, ts):
    conn.execute(
        "INSERT INTO events (ts, session_id, agent, event, payload) VALUES (?,?,?,?,?)",
        (int(ts.timestamp() * 1000), sid, agent, event, json.dumps(payload)),
    )


def _transcript(conn, sid, agent, action, model, ts, cost):
    r = random.Random(f"{sid}{action}{ts}")
    it, ot = r.randint(1500, 9000), r.randint(400, 3500)
    conn.execute(
        """INSERT INTO transcripts
           (id, session_id, task_id, agent, action, model, input_tokens,
            output_tokens, cache_read, cache_write, cost_usd, started_at,
            finished_at, artifact_path)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("trn_" + hashlib.sha256(f"{sid}{action}{ts}{r.random()}".encode()).hexdigest()[:16],
         sid, None, agent, action, model, it, ot,
         r.randint(0, it), r.randint(0, 800), cost,
         _ts(ts), _ts(ts + timedelta(seconds=r.randint(2, 40))), "transcripts/x.json"),
    )


def build_session(conn: sqlite3.Connection, *, goal: str, status: str,
                  n_hyps: int, with_overview: bool, age_hours: float,
                  budget: float) -> str:
    sid = _sid(goal)
    start = datetime.now(UTC) - timedelta(hours=age_hours)
    plan = content.make_plan(goal)
    r = random.Random(sid)

    # Insert a stub session row first so FK references resolve; finalized below.
    conn.execute(
        """INSERT OR REPLACE INTO sessions
           (id, created_at, updated_at, status, research_goal, research_plan,
            config_snapshot, budget_tokens, budget_usd, budget_used_tokens,
            budget_used_usd, wall_deadline, final_overview)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (sid, _ts(start), _ts(start), status, goal, json.dumps(plan), "{}",
         5_000_000, budget, 0, 0.0, None, None),
    )

    # ----- build hypotheses -----
    hyps = []
    n_clusters = max(2, n_hyps // 3)
    for i in range(n_hyps):
        strat = content.STRATEGIES[i % 4] if i < n_hyps * 0.7 else r.choice(
            ["combine", "simplify", "out_of_box", "feasibility"])
        created_by = "evolution" if strat in (
            "combine", "simplify", "out_of_box", "feasibility") else "generation"
        c = content.make_hypothesis(goal, i, strat)
        hid = _hid(sid, i)
        parent_ids = []
        if created_by == "evolution" and hyps:
            parent_ids = [r.choice(hyps[: max(1, i)])["id"]]
            if strat == "combine" and i > 2:
                parent_ids.append(r.choice(hyps[: i])["id"])
        # Hidden per-hyp quality seeds the initial Elo (1000..1800 + noise),
        # mirroring the real engine's review-composite seeding; Elo-expectation
        # match outcomes below then spread the leaderboard toward 1000-2000.
        # Quality stratified across the batch by index (with per-id jitter) so
        # seeds reliably span the range; small independent draws can cluster.
        rq = random.Random(f"{hid}|q")
        frac = min(1.0, max(0.0, (i + rq.uniform(-0.4, 0.4)) / max(1, n_hyps - 1)))
        q = 0.05 + 0.90 * frac
        seed_elo = round(1000 + 800 * q + rq.uniform(-15, 15), 1)
        hyps.append({
            "id": hid, "created_by": created_by, "strategy": strat,
            "parent_ids": list({p for p in parent_ids}),
            "title": c["title"], "summary": c["summary"], "full_text": c["full_text"],
            "citations": c["citations"], "cluster": f"clu_{i % n_clusters}",
            "elo": seed_elo, "elo0": seed_elo,  # elo0 = fixed quality anchor
            "matches": 0, "created_at": start + timedelta(minutes=2 + i * 3),
        })

    # ----- run an Elo tournament -----
    matches = []
    in_tournament = [h for h in hyps if h["created_at"] < start + timedelta(minutes=1e9)]
    n_rounds = 5 if status == "done" else (3 if status != "running" else 4)
    match_t = start + timedelta(minutes=n_hyps * 3 + 5)
    for _round in range(n_rounds):
        random.Random(f"{sid}{_round}").shuffle(in_tournament)
        for a, b in zip(in_tournament[::2], in_tournament[1::2]):
            if a is b:
                continue
            mode = "debate" if r.random() < 0.3 else "pairwise"
            # Win probability from each idea's fixed quality anchor (seed Elo), so
            # consistent winners climb toward 2000 and losers fall toward 1000
            # instead of mean-reverting — spreading the leaderboard 1000-2000.
            pa = 1 / (1 + 10 ** ((b["elo0"] - a["elo0"]) / 400))
            winner = "a" if r.random() < pa else "b"
            ra, rb = _elo_update(a["elo"], b["elo"], winner)
            mid = "mat_" + hashlib.sha256(
                f"{sid}{a['id']}{b['id']}{_round}".encode()).hexdigest()[:16]
            matches.append({
                "id": mid, "hyp_a": a["id"], "hyp_b": b["id"], "mode": mode,
                "winner": winner, "ea": a["elo"], "eb": b["elo"],
                "ea2": ra, "eb2": rb, "created_at": match_t,
                "similarity": round(r.uniform(0.05, 0.4), 2),
                "rationale": f"Under {mode}, idea {winner.upper()} offered a sharper "
                             "falsification criterion and stronger mechanistic grounding.",
            })
            a["elo"], b["elo"] = ra, rb
            a["matches"] += 1
            b["matches"] += 1
            match_t += timedelta(minutes=r.randint(1, 4))

    # rank + assign states
    hyps.sort(key=lambda h: -h["elo"])
    for rank, h in enumerate(hyps):
        if status == "running" and rank >= n_hyps - 2:
            h["state"] = "draft" if rank == n_hyps - 1 else "reviewed"
        elif rank == 0:
            h["state"] = "pinned"
        elif rank >= n_hyps - 1 and n_hyps > 4:
            h["state"] = "rejected"
        else:
            h["state"] = "in_tournament"

    # ----- write hypotheses + reviews + citations -----
    for h in hyps:
        conn.execute(
            """INSERT INTO hypotheses
               (id, session_id, created_at, created_by, strategy, parent_ids,
                title, summary, full_text, artifact_path, elo, matches_played,
                state, dedup_cluster)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (h["id"], sid, _ts(h["created_at"]), h["created_by"], h["strategy"],
             json.dumps(h["parent_ids"]), h["title"], h["summary"], h["full_text"],
             f"hypotheses/{h['id']}.json",
             h["elo"] if h["matches"] else None, h["matches"], h["state"], h["cluster"]),
        )
        for cit in h["citations"]:
            conn.execute(
                """INSERT INTO web_citations (hypothesis_id, title, url, excerpt, doi, year)
                   VALUES (?,?,?,?,?,?)""",
                (h["id"], cit["title"], cit["url"], cit["excerpt"], cit["doi"], cit["year"]),
            )
        if h["state"] in ("draft",):
            continue
        for kind in (["full", "verification"] if h["state"] != "reviewed" else ["full"]):
            rv = content.make_review(goal, h["title"], kind)
            rid = "rev_" + hashlib.sha256(f"{h['id']}{kind}".encode()).hexdigest()[:16]
            conn.execute(
                """INSERT INTO reviews
                   (id, hypothesis_id, session_id, created_at, kind, verdict,
                    novelty, correctness, testability, feasibility, body, artifact_path)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (rid, h["id"], sid, _ts(h["created_at"] + timedelta(minutes=4)),
                 kind, rv["verdict"], rv["scores"]["novelty"], rv["scores"]["correctness"],
                 rv["scores"]["testability"], rv["scores"]["feasibility"],
                 rv["body"], f"reviews/{rid}.json"),
            )

    # ----- write matches + elo journal -----
    for m in matches:
        conn.execute(
            """INSERT INTO tournament_matches
               (id, session_id, created_at, hyp_a, hyp_b, mode, winner,
                elo_a_before, elo_b_before, elo_a_after, elo_b_after,
                rationale, transcript_id, similarity)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (m["id"], sid, _ts(m["created_at"]), m["hyp_a"], m["hyp_b"], m["mode"],
             m["winner"], m["ea"], m["eb"], m["ea2"], m["eb2"],
             m["rationale"], None, m["similarity"]),
        )
        conn.execute(
            """INSERT OR IGNORE INTO elo_journal
               (update_id, match_id, hyp_a, hyp_b, winner, elo_a_before,
                elo_b_before, elo_a_after, elo_b_after, applied_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (m["id"], m["id"], m["hyp_a"], m["hyp_b"], m["winner"], m["ea"],
             m["eb"], m["ea2"], m["eb2"], int(m["created_at"].timestamp() * 1000)),
        )

    # ----- transcripts (cost) + events timeline -----
    total_cost = 0.0
    _emit(conn, sid, "supervisor", "session_started",
          {"goal": goal[:200], "n_initial": 3, "budget_usd": budget}, start)
    _transcript(conn, sid, "supervisor", "parse_goal", content.MODELS["supervisor"],
                start, 0.01)
    ev_t = start + timedelta(minutes=1)
    for h in hyps:
        agent = "evolution" if h["created_by"] == "evolution" else "generation"
        cost = round(r.uniform(0.04, 0.22), 4)
        total_cost += cost
        _transcript(conn, sid, agent, f"{agent}.{h['strategy']}",
                    content.MODELS[agent], h["created_at"], cost)
        _emit(conn, sid, agent, "hypothesis_created",
              {"hypothesis_id": h["id"], "title": h["title"][:80], "strategy": h["strategy"]},
              h["created_at"])
        if h["state"] not in ("draft",):
            rc = round(r.uniform(0.03, 0.12), 4)
            total_cost += rc
            _transcript(conn, sid, "reflection", "reflection.full",
                        content.MODELS["reflection"], h["created_at"] + timedelta(minutes=4), rc)
            _emit(conn, sid, "reflection", "review_completed",
                  {"hypothesis_id": h["id"], "kind": "full"},
                  h["created_at"] + timedelta(minutes=4))
    for m in matches:
        cost = round(r.uniform(0.01, 0.06), 4)
        total_cost += cost
        _transcript(conn, sid, "ranking", f"ranking.{m['mode']}",
                    content.MODELS["ranking"], m["created_at"], cost)
        _emit(conn, sid, "ranking", "match_complete",
              {"match_id": m["id"], "winner": m["winner"], "mode": m["mode"]}, m["created_at"])

    # feedback
    if n_hyps > 4:
        conn.execute(
            """INSERT INTO system_feedback
               (id, session_id, created_at, source, kind, target_id, text, active)
               VALUES (?,?,?,?,?,?,?,1)""",
            ("fb_" + hashlib.sha256(f"{sid}fb".encode()).hexdigest()[:12], sid,
             _ts(start + timedelta(minutes=20)), "meta_review", "system_feedback", None,
             "Hypotheses cluster heavily around repurposing; encourage at least one "
             "out-of-box mechanism per generation round to widen coverage."),
        )

    final_overview = None
    if with_overview:
        top_hyps = sorted(hyps, key=lambda h: -h["elo"])[:5]
        ov_md = content.make_overview(goal, top_hyps)
        import os
        from .store import REPO_ROOT
        ov_dir = REPO_ROOT / "data" / "artifacts" / sid / "final"
        ov_dir.mkdir(parents=True, exist_ok=True)
        (ov_dir / "overview.md").write_text(ov_md)
        final_overview = os.path.join("artifacts", sid, "final", "overview.md")
        _emit(conn, sid, "metareview", "session_done", {"stop_reason": "ELO_STABLE"},
              match_t + timedelta(minutes=5))

    updated = match_t + timedelta(minutes=6)
    budget_used = round(total_cost, 2)
    # UPDATE (not INSERT OR REPLACE): replacing the row would CASCADE-delete all
    # the child hypotheses/matches we just wrote.
    conn.execute(
        """UPDATE sessions SET updated_at=?, config_snapshot=?,
               budget_used_tokens=?, budget_used_usd=?, wall_deadline=?,
               final_overview=? WHERE id=?""",
        (_ts(updated),
         json.dumps({"llm": {"provider": "anthropic"}, "models": content.MODELS}),
         int(budget_used * 220_000), budget_used,
         _ts(start + timedelta(hours=2)), final_overview, sid),
    )
    return sid


DEMO_GOALS = [
    ("Identify novel drug-repurposing candidates for acute myeloid leukemia (AML)",
     "done", 12, True, 30.0, 5.0),
    ("Propose mechanisms by which the gut microbiome drives chronic intestinal inflammation",
     "running", 8, False, 1.2, 4.0),
    ("Find testable hypotheses for reversing cellular senescence in fibrotic tissue",
     "done", 10, True, 72.0, 6.0),
    ("Generate hypotheses for overcoming T-cell exhaustion in solid tumors",
     "paused", 7, False, 5.0, 4.0),
]


def seed(db=DEFAULT_DB, reset: bool = False) -> list[str]:
    conn = connect(db)
    conn.executescript(EXTRA_TABLES)
    if reset:
        rows = conn.execute(
            "SELECT id FROM sessions WHERE id LIKE ?", (DEMO_TAG + "%",)
        ).fetchall()
        for (sid,) in rows:
            mids = [r[0] for r in conn.execute(
                "SELECT id FROM tournament_matches WHERE session_id=?", (sid,))]
            hids = [r[0] for r in conn.execute(
                "SELECT id FROM hypotheses WHERE session_id=?", (sid,))]
            for mid in mids:
                conn.execute("DELETE FROM elo_journal WHERE match_id=?", (mid,))
            for hid in hids:
                conn.execute("DELETE FROM web_citations WHERE hypothesis_id=?", (hid,))
            conn.execute("DELETE FROM events WHERE session_id=?", (sid,))
            # FK ON DELETE CASCADE clears hypotheses/reviews/matches/transcripts/
            # system_feedback/tasks when the parent session is removed.
            conn.execute("DELETE FROM sessions WHERE id=?", (sid,))
        conn.commit()
    ids = []
    for goal, status, n, ov, age, budget in DEMO_GOALS:
        ids.append(build_session(conn, goal=goal, status=status, n_hyps=n,
                                 with_overview=ov, age_hours=age, budget=budget))
    conn.commit()
    conn.close()
    return ids


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true")
    ap.add_argument("--db", default=str(DEFAULT_DB))
    args = ap.parse_args()
    ids = seed(args.db, reset=args.reset)
    print(f"Seeded {len(ids)} demo sessions into {args.db}")
    for i in ids:
        print("  ", i)
