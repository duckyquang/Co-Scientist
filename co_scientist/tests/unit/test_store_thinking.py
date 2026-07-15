"""The webapp store (frontend serializer) surfaces the real captured `thinking`
on hypotheses and their reviews via SELECT *. Empty when none was produced."""

from __future__ import annotations


def _seed(conn, sid: str, hid: str, *, hyp_thinking, rev_thinking) -> None:
    conn.execute(
        """INSERT INTO sessions (id, created_at, updated_at, status, research_goal,
               research_plan, config_snapshot, budget_tokens, budget_usd)
           VALUES (?, 't', 't', 'done', 'g', '{}', '{}', 1, 1.0)""",
        (sid,),
    )
    conn.execute(
        """INSERT INTO hypotheses (id, session_id, created_at, created_by, strategy,
               title, summary, full_text, thinking, artifact_path, state)
           VALUES (?, ?, 't', 'generation', 'literature', 'T', 'S', 'F', ?, 'a.json', 'draft')""",
        (hid, sid, hyp_thinking),
    )
    conn.execute(
        """INSERT INTO reviews (id, hypothesis_id, session_id, created_at, kind,
               body, thinking, artifact_path)
           VALUES ('r1', ?, ?, 't', 'full', 'B', ?, 'r.json')""",
        (hid, sid, rev_thinking),
    )
    conn.commit()


def test_store_surfaces_thinking(tmp_path):
    from webapp import store

    conn = store.connect(tmp_path / "co_scientist.db")
    _seed(conn, "s1", "h1",
          hyp_thinking="Chose pathway A: more testable.",
          rev_thinking="Novelty holds; correctness has a gap.")
    h = store.get_hypothesis(conn, "h1")
    assert h["thinking"] == "Chose pathway A: more testable."
    assert h["reviews"][0]["thinking"] == "Novelty holds; correctness has a gap."
    conn.close()


def test_store_thinking_null_when_absent(tmp_path):
    from webapp import store

    conn = store.connect(tmp_path / "co_scientist.db")
    _seed(conn, "s1", "h1", hyp_thinking=None, rev_thinking=None)
    h = store.get_hypothesis(conn, "h1")
    assert h["thinking"] is None
    assert h["reviews"][0]["thinking"] is None
    conn.close()
