"""Tests for the pure Elo math + idempotent persistence."""

from __future__ import annotations

import math
from datetime import UTC, datetime

import pytest

from co_scientist import ids
from co_scientist.models import Hypothesis, TournamentMatch
from co_scientist.orchestrator.elo import expected_score, k_factor, update_elo
from co_scientist.storage.repos import hypotheses as hyp_repo
from co_scientist.storage.repos import tournaments as tourney_repo


def test_equal_ratings_expect_half() -> None:
    assert expected_score(1200, 1200) == pytest.approx(0.5)


def test_higher_rating_favored() -> None:
    assert expected_score(1500, 1200) > 0.8
    assert expected_score(1200, 1500) < 0.2


def test_k_factor_decays() -> None:
    assert k_factor(0) == 48
    assert k_factor(4) == 48
    assert k_factor(5) == 32
    assert k_factor(100) == 32


def test_update_zero_sum() -> None:
    u = update_elo(1200, 1200, "a", matches_played_min=0)
    # zero-sum
    assert math.isclose(u.elo_a_after + u.elo_b_after, 2400, abs_tol=1e-9)
    # winner gains, loser drops
    assert u.elo_a_after > 1200
    assert u.elo_b_after < 1200


def test_underdog_win_is_high_payoff() -> None:
    u = update_elo(1100, 1500, "a", matches_played_min=10)
    # K=32, expected_a ~0.09, delta = 32*(1 - 0.09) = ~29
    assert 26 < u.elo_a_after - 1100 < 32


@pytest.mark.asyncio
async def test_apply_elo_update_is_idempotent(conn) -> None:
    """Re-applying the same match_id never double-counts."""
    now = datetime.now(UTC)

    # Set up a session row + two hypotheses in tournament
    await conn.execute(
        """INSERT INTO sessions(id, created_at, updated_at, status, research_goal,
                                 research_plan, config_snapshot, budget_tokens, budget_usd)
           VALUES ('ses_t', ?, ?, 'running', 'test', '{}', '{}', 1000000, 10.0)""",
        (now.isoformat(), now.isoformat()),
    )
    await conn.commit()

    for hid in ("hyp_x", "hyp_y"):
        h = Hypothesis(
            id=hid, session_id="ses_t", created_at=now,
            created_by="generation", strategy="literature",
            title="t", summary="s", full_text="f",
            artifact_path=f"artifacts/ses_t/hypotheses/{hid}.json",
            elo=1200, matches_played=0, state="in_tournament",
        )
        await hyp_repo.insert(conn, h)

    mid = ids.match_id("hyp_x", "hyp_y", "round1")
    m = TournamentMatch(
        id=mid, session_id="ses_t", created_at=now,
        hyp_a="hyp_x", hyp_b="hyp_y", mode="pairwise", winner="a",
        elo_a_before=1200.0, elo_b_before=1200.0,
        elo_a_after=1216.0, elo_b_after=1184.0, rationale="test",
    )
    await tourney_repo.insert_match(conn, m)

    ok1 = await tourney_repo.apply_elo_update(
        conn, match_id=mid, hyp_a="hyp_x", hyp_b="hyp_y", winner="a",
        elo_a_before=1200.0, elo_b_before=1200.0,
        elo_a_after=1216.0, elo_b_after=1184.0,
    )
    assert ok1 is True

    # Re-apply: should no-op.
    ok2 = await tourney_repo.apply_elo_update(
        conn, match_id=mid, hyp_a="hyp_x", hyp_b="hyp_y", winner="a",
        elo_a_before=1200.0, elo_b_before=1200.0,
        elo_a_after=1216.0, elo_b_after=1184.0,
    )
    assert ok2 is False

    # State reflects exactly one update
    hx = await hyp_repo.fetch(conn, "hyp_x")
    hy = await hyp_repo.fetch(conn, "hyp_y")
    assert hx is not None and hy is not None
    assert hx.elo == 1216.0
    assert hy.elo == 1184.0
    assert hx.matches_played == 1
    assert hy.matches_played == 1


@pytest.mark.asyncio
async def test_elo_series_builds_per_hypothesis_trajectory(conn) -> None:
    """elo_series returns per-hypothesis [{i, elo}] over match history, ordered
    by created_at, restricted to the requested ids and skipping unrecorded Elo."""
    from datetime import timedelta

    base = datetime.now(UTC)
    await conn.execute(
        """INSERT INTO sessions(id, created_at, updated_at, status, research_goal,
                                 research_plan, config_snapshot, budget_tokens, budget_usd)
           VALUES ('ses_s', ?, ?, 'running', 'test', '{}', '{}', 1000000, 10.0)""",
        (base.isoformat(), base.isoformat()),
    )
    await conn.commit()

    for hid in ("a", "b", "c"):
        await hyp_repo.insert(conn, Hypothesis(
            id=hid, session_id="ses_s", created_at=base,
            created_by="generation", strategy="literature",
            title="t", summary="s", full_text="f",
            artifact_path=f"artifacts/ses_s/hypotheses/{hid}.json",
            elo=1200, matches_played=0, state="in_tournament",
        ))

    # Three matches over two tracked hypotheses (a, b); c is untracked noise.
    matches = [
        ("a", "b", 1216.0, 1184.0),
        ("a", "c", 1230.0, 1170.0),
        ("b", "c", 1200.0, 1160.0),
    ]
    for i, (ha, hb, ea, eb) in enumerate(matches):
        m = TournamentMatch(
            id=f"m{i}", session_id="ses_s", created_at=base + timedelta(minutes=i),
            hyp_a=ha, hyp_b=hb, mode="pairwise", winner="a",
            elo_a_before=1200.0, elo_b_before=1200.0,
            elo_a_after=ea, elo_b_after=eb, rationale="r",
        )
        await tourney_repo.insert_match(conn, m)

    series = await tourney_repo.elo_series(conn, "ses_s", ["a", "b"])
    # 'a' played matches 0 and 1; 'b' played matches 0 and 2. 'c' excluded.
    assert set(series.keys()) == {"a", "b"}
    assert series["a"] == [{"i": 0, "elo": 1216.0}, {"i": 1, "elo": 1230.0}]
    assert series["b"] == [{"i": 0, "elo": 1184.0}, {"i": 2, "elo": 1200.0}]
    # empty id list → empty result
    assert await tourney_repo.elo_series(conn, "ses_s", []) == {}
