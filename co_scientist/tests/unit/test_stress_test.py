"""Tests for the finalize stress-test stage: the `only_ids` ranking filter,
the new feedback/review Literals + contract row shape, and `_run_stress_stage`
ordering with stubbed agents. No LLM calls."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from co_scientist import ids
from co_scientist.agents.ranking import RankingAgent
from co_scientist.agents.stresstest import _render_stress_md
from co_scientist.agents.supervisor import Supervisor
from co_scientist.models import (
    Hypothesis,
    ResearchPlan,
    Review,
    ReviewScores,
    Session,
    SystemFeedback,
    Task,
    TaskResult,
)
from co_scientist.storage.repos import feedback as fb_repo
from co_scientist.storage.repos import hypotheses as hyp_repo
from co_scientist.storage.repos import reviews as rev_repo
from co_scientist.storage.repos import sessions as sess_repo


def _now() -> datetime:
    return datetime.now(UTC)


async def _make_session(conn, sid: str = "ses_stress") -> Session:
    s = Session(
        id=sid, created_at=_now(), updated_at=_now(), status="running",
        research_goal="Test goal", research_plan=ResearchPlan(objective="x"),
        config_snapshot={}, budget_tokens=1_000_000, budget_usd=0.0,
        budget_used_tokens=500_000,
    )
    await sess_repo.insert(conn, s)
    return s


async def _add_hyp(conn, session_id: str, n: int, *, elo: float, state: str = "in_tournament") -> str:
    hid = ids.hypothesis_id(session_id, "generation/literature", f"statement {n}")
    await hyp_repo.insert(conn, Hypothesis(
        id=hid, session_id=session_id, created_at=_now(),
        created_by="generation", strategy="literature",
        title=f"h{n}", summary="s", full_text="f",
        artifact_path=f"artifacts/{session_id}/hypotheses/{hid}.json",
        elo=elo, matches_played=5, state=state,
    ))
    return hid


# ----------------------------- only_ids filter ----------------------------- #


@pytest.mark.asyncio
async def test_only_ids_restricts_pair_candidates(tmp_cfg, conn) -> None:
    """RunTournamentBatch with only_ids must draw pairs from that id set only."""
    s = await _make_session(conn)
    a = await _add_hyp(conn, s.id, 1, elo=1300)
    b = await _add_hyp(conn, s.id, 2, elo=1250)
    await _add_hyp(conn, s.id, 3, elo=1200)   # excluded

    from co_scientist.agents.base import AgentDeps

    agent = RankingAgent(AgentDeps(cfg=tmp_cfg, db=conn, llm=None, tools=None))
    seen: list[list[str]] = []

    async def _capture(session_id, candidates, *, focus_id):
        seen.append([h.id for h in candidates])
        return None   # → noop, no LLM

    agent._select_pair = _capture  # type: ignore[assignment]
    task = Task(
        id=ids.task_id(), session_id=s.id, created_at=_now(),
        agent="ranking", action="RunTournamentBatch",
        payload={"only_ids": [a, b]},
    )
    res = await agent._run_tournament_batch(task)
    assert res.kind == "noop"
    assert seen == [[a, b]] or seen == [[b, a]]
    assert all(set(c) == {a, b} for c in seen)


@pytest.mark.asyncio
async def test_only_ids_below_two_is_noop(tmp_cfg, conn) -> None:
    s = await _make_session(conn)
    a = await _add_hyp(conn, s.id, 1, elo=1300)
    await _add_hyp(conn, s.id, 2, elo=1250)

    from co_scientist.agents.base import AgentDeps

    agent = RankingAgent(AgentDeps(cfg=tmp_cfg, db=conn, llm=None, tools=None))
    task = Task(
        id=ids.task_id(), session_id=s.id, created_at=_now(),
        agent="ranking", action="RunTournamentBatch",
        payload={"only_ids": [a]},   # only one valid → cannot pair
    )
    res = await agent._run_tournament_batch(task)
    assert res.kind == "noop"
    assert res.extra["reason"] == "fewer than 2 candidates"


# ----------------------------- Literals + contract row ----------------------------- #


@pytest.mark.asyncio
async def test_stress_test_literals_and_row_shapes(tmp_cfg, conn) -> None:
    s = await _make_session(conn)
    hid = await _add_hyp(conn, s.id, 1, elo=1300)

    # Review with the new kind + verdict round-trips.
    rid = ids.review_id(hid, "stress_test", iteration=0)
    await rev_repo.insert(conn, Review(
        id=rid, hypothesis_id=hid, session_id=s.id, created_at=_now(),
        kind="stress_test", verdict="survives_with_fixes",
        scores=ReviewScores(correctness=0.7, testability=0.8, feasibility=0.6),
        body="body", artifact_path=f"artifacts/{s.id}/reviews/{rid}.json",
    ))
    got = await rev_repo.list_for_hypothesis(conn, hid)
    assert got and got[0].kind == "stress_test"
    assert got[0].verdict == "survives_with_fixes"

    # Contract per-hypothesis feedback row: kind, target_id, two sections.
    text = "## Thinking\n\nreasoning\n\n## Stress test\n\nreport"
    await fb_repo.insert(conn, SystemFeedback(
        id=ids.feedback_id(), session_id=s.id, created_at=_now(),
        source="meta_review", kind="stress_test", target_id=hid, text=text,
    ))
    # Contract summary row: kind, target_id None.
    await fb_repo.insert(conn, SystemFeedback(
        id=ids.feedback_id(), session_id=s.id, created_at=_now(),
        source="meta_review", kind="stress_ranking", target_id=None,
        text="## Stress-tested final ranking\n\n1. ...",
    ))
    summary = await fb_repo.latest_system_feedback(conn, s.id, kind="stress_ranking")
    assert summary is not None and summary.target_id is None
    per_hyp = await fb_repo.latest_system_feedback(conn, s.id, kind="stress_test")
    assert per_hyp is not None and per_hyp.target_id == hid
    assert "## Thinking" in per_hyp.text and "## Stress test" in per_hyp.text


def test_render_stress_md_covers_all_moves() -> None:
    md = _render_stress_md({
        "verdict": "survives_with_fixes",
        "contradicting_evidence": [
            {"claim": "c", "url": "http://x", "excerpt": "e"},
        ],
        "citation_checks": [
            {"url": "http://y", "supports_claim": False, "note": "tangential"},
        ],
        "feasibility_check": "dose is 10x too high",
        "pilot_experiment": {
            "model_system": "mouse", "intervention": "drug",
            "readout": "weight", "success_criterion": ">20% drop", "scale": "n=8, 2 weeks",
        },
        "fix_directives": ["lower the dose"],
    })
    assert "Verdict" in md
    assert "Contradicting evidence" in md
    assert "does NOT support" in md
    assert "Prototype-scale pilot" in md
    assert "n=8, 2 weeks" in md
    assert "lower the dose" in md


# ----------------------------- stage ordering ----------------------------- #


class _StubStress:
    """Stress agent stub: proposes a fix and (on ApplyStressFixes) creates a child."""

    def __init__(self, conn, session_id: str) -> None:
        self._conn = conn
        self._sid = session_id

    async def execute(self, task: Task) -> TaskResult:
        if task.action == "StressTestHypothesis":
            return TaskResult(
                kind="stress_test_completed", hypothesis_ids=[task.target_id],
                extra={"verdict": "survives_with_fixes",
                       "fix_directives": ["tighten claim"], "report": "r"},
            )
        if task.action == "ApplyStressFixes":
            child = ids.hypothesis_id(self._sid, "evolution/feedback_driven",
                                      f"fix of {task.target_id}")
            await hyp_repo.insert(self._conn, Hypothesis(
                id=child, session_id=self._sid, created_at=_now(),
                created_by="evolution", strategy="feedback_driven",
                parent_ids=[task.target_id], title=f"fixed {task.target_id}",
                summary="s", full_text="f",
                artifact_path=f"artifacts/{self._sid}/hypotheses/{child}.json",
                state="draft",
            ))
            return TaskResult(kind="hypothesis_created", hypothesis_ids=[child],
                              extra={"parent": task.target_id, "child_id": child})
        return TaskResult(kind="noop")


class _StubNoop:
    async def execute(self, task: Task) -> TaskResult:
        return TaskResult(kind="noop")


@pytest.mark.asyncio
async def test_stress_stage_writes_ranking_after_fixes(tmp_cfg, conn) -> None:
    sup = Supervisor(tmp_cfg)
    s = await _make_session(conn)
    await _add_hyp(conn, s.id, 1, elo=1400)
    await _add_hyp(conn, s.id, 2, elo=1300)

    stubs = {"stresstest": _StubStress(conn, s.id),
             "ranking": _StubNoop(), "reflection": _StubNoop()}
    sup._build_agents = lambda deps: stubs  # type: ignore[assignment]

    from co_scientist.agents.base import AgentDeps

    deps = AgentDeps(cfg=tmp_cfg, db=conn, llm=None, tools=None)
    await sup._run_stress_stage(conn, deps, s)

    # A single stress_ranking summary row now exists (written after the fixes).
    summary = await fb_repo.latest_system_feedback(conn, s.id, kind="stress_ranking")
    assert summary is not None
    # Both finalists were fixed → children exist and are referenced.
    children = [h for h in await hyp_repo.list_for_session(conn, s.id)
                if h.strategy == "feedback_driven"]
    assert len(children) == 2
    for c in children:
        assert c.id in summary.text

    # Idempotent: a second run is skipped (row already present).
    await sup._run_stress_stage(conn, deps, s)
    rows = [r async for r in _iter_feedback(conn, s.id, "stress_ranking")]
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_stress_stage_skips_with_one_finalist(tmp_cfg, conn) -> None:
    sup = Supervisor(tmp_cfg)
    s = await _make_session(conn)
    await _add_hyp(conn, s.id, 1, elo=1400)   # only one in-tournament

    stubs = {"stresstest": _StubStress(conn, s.id), "ranking": _StubNoop()}
    sup._build_agents = lambda deps: stubs  # type: ignore[assignment]

    from co_scientist.agents.base import AgentDeps

    deps = AgentDeps(cfg=tmp_cfg, db=conn, llm=None, tools=None)
    await sup._run_stress_stage(conn, deps, s)
    assert await fb_repo.latest_system_feedback(conn, s.id, kind="stress_ranking") is None


async def _iter_feedback(conn, session_id: str, kind: str):
    async with conn.execute(
        "SELECT id FROM system_feedback WHERE session_id=? AND kind=?",
        (session_id, kind),
    ) as cur:
        for row in await cur.fetchall():
            yield row["id"]
