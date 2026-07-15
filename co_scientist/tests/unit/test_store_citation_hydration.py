"""Drawer citations on real-engine DBs: store.get_hypothesis falls back to the
hypothesis artifact JSON ({"record": {"citations": [...]}}) when the demo-only
web_citations side table is absent/empty (the real engine never writes it)."""

from __future__ import annotations

import json


def _seed(conn, sid: str, hid: str, artifact_path: str) -> None:
    conn.execute(
        """INSERT INTO sessions (id, created_at, updated_at, status, research_goal,
               research_plan, config_snapshot, budget_tokens, budget_usd)
           VALUES (?, 't', 't', 'done', 'g', '{}', '{}', 1, 1.0)""",
        (sid,),
    )
    conn.execute(
        """INSERT INTO hypotheses (id, session_id, created_at, created_by, strategy,
               title, summary, full_text, artifact_path, state)
           VALUES (?, ?, 't', 'generation', 'literature', 'T', 'S', 'F', ?, 'draft')""",
        (hid, sid, artifact_path),
    )
    conn.commit()


def test_citations_hydrate_from_artifact_json(tmp_path):
    from webapp import store

    conn = store.connect(tmp_path / "co_scientist.db")
    cite = {
        "title": "Pathway X regulates Y",
        "url": "https://doi.org/10.1038/s41586",
        "excerpt": "...reduced markers by 60%...",
        "doi": "10.1038/s41586",
        "year": 2023,
    }
    art = tmp_path / "artifacts" / "s1" / "hypotheses" / "h1.json"
    art.parent.mkdir(parents=True)
    art.write_text(json.dumps({"record": {"citations": [cite, "not-a-dict"]}}))

    _seed(conn, "s1", "h1", "artifacts/s1/hypotheses/h1.json")
    h = store.get_hypothesis(conn, "h1")
    assert h["citations"] == [cite]  # non-dict entry dropped, shape preserved
    conn.close()


def test_missing_or_malformed_artifact_gives_empty(tmp_path):
    from webapp import store

    conn = store.connect(tmp_path / "co_scientist.db")
    _seed(conn, "s1", "h_missing", "artifacts/s1/hypotheses/nope.json")

    bad = tmp_path / "artifacts" / "s1" / "hypotheses" / "bad.json"
    bad.parent.mkdir(parents=True)
    bad.write_text("{not json")
    conn.execute(
        "INSERT INTO hypotheses (id, session_id, created_at, created_by, strategy,"
        " title, summary, full_text, artifact_path, state)"
        " VALUES ('h_bad', 's1', 't', 'generation', 'literature',"
        " 'T', 'S', 'F', 'artifacts/s1/hypotheses/bad.json', 'draft')"
    )
    conn.execute(
        "INSERT INTO hypotheses (id, session_id, created_at, created_by, strategy,"
        " title, summary, full_text, artifact_path, state)"
        " VALUES ('h_esc', 's1', 't', 'generation', 'literature',"
        " 'T', 'S', 'F', '../outside.json', 'draft')"
    )
    conn.commit()

    assert store.get_hypothesis(conn, "h_missing")["citations"] == []
    assert store.get_hypothesis(conn, "h_bad")["citations"] == []
    assert store.get_hypothesis(conn, "h_esc")["citations"] == []  # traversal refused
    conn.close()
