"""Tests for Supervisor idle scheduling (`_decide_next_steps`) and the
self-critique follow-up rule — no LLM calls, DB-backed queue only."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from co_scientist import ids
from co_scientist.agents.supervisor import Supervisor
from co_scientist.models import (
    Hypothesis,
    ResearchPlan,
    Session,
    TaskResult,
    TournamentMatch,
)
from co_scientist.storage.repos import hypotheses as hyp_repo
from co_scientist.storage.repos import sessions as sess_repo
from co_scientist.storage.repos import tournaments as tourney_repo


def _now() -> datetime:
    return datetime.now(UTC)


async def _make_session(conn, sid: str = "ses_sched") -> Session:
    s = Session(
        id=sid, created_at=_now(), updated_at=_now(), status="running",
        research_goal="Test goal",
        research_plan=ResearchPlan(objective="x"),
        config_snapshot={}, budget_tokens=1_000_000, budget_usd=0.0,
    )
    await sess_repo.insert(conn, s)
    return s


async def _add_hyp(conn, session_id: str, n: int, *, matches_played: int, elo: float) -> str:
    hid = ids.hypothesis_id(session_id, "generation/literature", f"statement {n}")
    await hyp_repo.insert(conn, Hypothesis(
        id=hid, session_id=session_id, created_at=_now(),
        created_by="generation", strategy="literature",
        title=f"h{n}", summary="s", full_text="f",
        artifact_path=f"artifacts/{session_id}/hypotheses/{hid}.json",
        elo=elo, matches_played=matches_played, state="in_tournament",
    ))
    return hid


async def _add_matches(conn, session_id: str, hyp_a: str, hyp_b: str, n: int) -> None:
    for i in range(n):
        await tourney_repo.insert_match(conn, TournamentMatch(
            id=ids.match_id(hyp_a, hyp_b, f"r{i}"), session_id=session_id,
            created_at=_now(), hyp_a=hyp_a, hyp_b=hyp_b, mode="pairwise",
            winner="a", elo_a_before=1200, elo_b_before=1200,
        ))


async def _tasks(conn, session_id: str, action: str) -> list:
    async with conn.execute(
        "SELECT * FROM tasks WHERE session_id=? AND action=?",
        (session_id, action),
    ) as cur:
        return list(await cur.fetchall())


@pytest.mark.asyncio
async def test_one_critique_per_bucket_and_no_dedup_inflation(tmp_cfg, conn) -> None:
    sup = Supervisor(tmp_cfg)
    s = await _make_session(conn)
    a = await _add_hyp(conn, s.id, 1, matches_played=8, elo=1300)
    b = await _add_hyp(conn, s.id, 2, matches_played=7, elo=1250)
    await _add_matches(conn, s.id, a, b, 15)   # bucket 1 at critique_every=15

    n1 = await sup._decide_next_steps(conn, s)
    crits = await _tasks(conn, s.id, "GenerateSelfCritique")
    assert len(crits) == 1
    assert crits[0]["idempotency_key"] == f"{s.id}::metareview::critique::1"
    assert n1 >= 2   # tournament batch + critique

    # Same state → every idempotency key collides → nothing newly scheduled,
    # and collisions must not be counted (else IDLE is unreachable).
    n2 = await sup._decide_next_steps(conn, s)
    assert n2 == 0
    assert len(await _tasks(conn, s.id, "GenerateSelfCritique")) == 1


@pytest.mark.asyncio
async def test_no_critique_before_first_bucket(tmp_cfg, conn) -> None:
    sup = Supervisor(tmp_cfg)
    s = await _make_session(conn)
    a = await _add_hyp(conn, s.id, 1, matches_played=3, elo=1300)
    b = await _add_hyp(conn, s.id, 2, matches_played=3, elo=1250)
    await _add_matches(conn, s.id, a, b, 14)   # below critique_every=15

    await sup._decide_next_steps(conn, s)
    assert await _tasks(conn, s.id, "GenerateSelfCritique") == []


@pytest.mark.asyncio
async def test_evolution_gate_at_min_mature(tmp_cfg, conn) -> None:
    assert tmp_cfg.run.evolution_min_mature == 4
    sup = Supervisor(tmp_cfg)
    s = await _make_session(conn)
    for i in range(3):
        await _add_hyp(conn, s.id, i, matches_played=3, elo=1200 + i)
    await _add_hyp(conn, s.id, 99, matches_played=2, elo=1100)   # not mature

    await sup._decide_next_steps(conn, s)
    assert await _tasks(conn, s.id, "EvolveTopHypotheses") == []

    # 4th mature hypothesis unlocks evolution.
    await _add_hyp(conn, s.id, 4, matches_played=3, elo=1400)
    await sup._decide_next_steps(conn, s)
    assert len(await _tasks(conn, s.id, "EvolveTopHypotheses")) == 1


@pytest.mark.asyncio
async def test_critique_follow_up_re_reviews_top_3(tmp_cfg, conn) -> None:
    sup = Supervisor(tmp_cfg)
    s = await _make_session(conn)
    hids = [
        await _add_hyp(conn, s.id, i, matches_played=5, elo=1500 - i * 50)
        for i in range(5)
    ]

    from co_scientist.models import Task
    trigger = Task(
        id=ids.task_id(), session_id=s.id, created_at=_now(),
        agent="metareview", action="GenerateSelfCritique",
        payload={"round": 2}, priority=130, status="pending",
        idempotency_key=f"{s.id}::metareview::critique::2",
    )
    result = TaskResult(kind="self_critique_generated", extra={"round": 2})
    await sup._apply_follow_ups(conn, s, trigger, result)

    reviews = await _tasks(conn, s.id, "ReviewHypothesis")
    assert len(reviews) == 3
    assert {r["target_id"] for r in reviews} == set(hids[:3])
    assert all(r["idempotency_key"].endswith("::critique2") for r in reviews)

    # Re-applying the same follow-up is idempotent.
    await sup._apply_follow_ups(conn, s, trigger, result)
    assert len(await _tasks(conn, s.id, "ReviewHypothesis")) == 3
