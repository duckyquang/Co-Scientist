#!/usr/bin/env python3
"""Export seeded demo data as static JSON for GitHub Pages.

Run before `npm run build:pages` in CI (or locally):

    python scripts/export_static_demo.py
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from webapp.seed import EXTRA_TABLES, seed  # noqa: E402
from webapp.server import PROVIDERS  # noqa: E402
from webapp.store import (  # noqa: E402
    REPO_ROOT,
    clusters,
    connect,
    cost_by_agent,
    elo_history_all,
    get_hypothesis,
    get_session,
    global_stats,
    lineage,
    list_feedback,
    list_hypotheses,
    list_matches,
    list_sessions,
    metrics,
    recent_events,
    session_counts,
    usage_summary,
)


def _write(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, default=str) + "\n")


def export(db_path: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    conn = connect(db_path)
    conn.executescript(EXTRA_TABLES)

    _write(out / "meta.json", {
        "demo_mode": True,
        "static_demo": True,
        "hosted": False,
        "requires_api_key": False,
        "default_provider": "groq",
        "default_model": "llama-3.3-70b-versatile",
        "readme_local_url": "https://github.com/duckyquang/Co-Scientist#option-1-run-locally",
        "providers": PROVIDERS,
        "models": {
            "parse_goal": "llama-3.3-70b-versatile",
            "generation": "llama-3.3-70b-versatile",
            "reflection": "llama-3.3-70b-versatile",
            "ranking_pairwise": "llama-3.3-70b-versatile",
            "metareview_final": "llama-3.3-70b-versatile",
        },
        "defaults": {"budget_usd": 5.0, "budget_tokens": 5_000_000,
                     "n_initial": 4, "wall_clock_seconds": 1800},
    })
    _write(out / "stats.json", global_stats(conn))
    _write(out / "sessions.json", {"sessions": list_sessions(conn)})

    for row in list_sessions(conn):
        sid = row["id"]
        sdir = out / "sessions" / sid
        s = get_session(conn, sid)
        if not s:
            continue
        _write(sdir / "detail.json", {
            "session": s,
            "metrics": metrics(conn, sid),
            "counts": session_counts(conn, sid),
            "live": False,
        })
        hyps = list_hypotheses(conn, sid)
        _write(sdir / "hypotheses.json", {"hypotheses": hyps})
        for h in hyps:
            full = get_hypothesis(conn, h["id"])
            if full:
                _write(sdir / "hypotheses" / f"{h['id']}.json", full)
        _write(sdir / "matches.json", {"matches": list_matches(conn, sid)})
        _write(sdir / "cost.json", {
            "by_agent": cost_by_agent(conn, sid),
            "summary": usage_summary(conn, sid),
        })
        _write(sdir / "feedback.json", {"feedback": list_feedback(conn, sid)})
        _write(sdir / "lineage.json", lineage(conn, sid))
        _write(sdir / "clusters.json", {"points": clusters(conn, sid)})
        _write(sdir / "elo-history.json", {"series": elo_history_all(conn, sid)})
        _write(sdir / "events.json", {"events": recent_events(conn, sid, 0)})

        if s.get("final_overview"):
            base = (REPO_ROOT / "data").resolve()
            try:
                p = (REPO_ROOT / "data" / s["final_overview"]).resolve()
                p.relative_to(base)
                if p.is_file():
                    _write(sdir / "overview.json", {"markdown": p.read_text()})
            except (ValueError, OSError):
                pass

    conn.close()


def main() -> None:
    out = REPO / "frontend" / "public" / "demo"
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "export.db"
        seed(db, reset=True)
        export(db, out)
    n = len(list((out / "sessions").glob("*/detail.json")))
    print(f"Exported static demo to {out} ({n} sessions)")


if __name__ == "__main__":
    main()
