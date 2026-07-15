"""cfg.run.high_risk injects the directive into the applied plan's preferences."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from co_scientist.agents.supervisor import HIGH_RISK_DIRECTIVE, Supervisor
from co_scientist.models import ResearchPlan, Session
from co_scientist.storage.repos import sessions as sess_repo


def _session(sid: str) -> Session:
    now = datetime.now(UTC)
    return Session(
        id=sid, created_at=now, updated_at=now, status="running",
        research_goal="Test goal",
        research_plan=ResearchPlan(objective="x"),
        config_snapshot={}, budget_tokens=1_000_000, budget_usd=0.0,
    )


@pytest.mark.asyncio
async def test_high_risk_appends_directive_to_applied_plan(tmp_cfg, conn) -> None:
    tmp_cfg.run.high_risk = True
    sup = Supervisor(tmp_cfg)
    s = _session("ses_hr_on")
    await sess_repo.insert(conn, s)
    plan = ResearchPlan(objective="x", preferences=["favor testable ideas"])

    await sup._apply_plan(conn, s, plan)

    fetched = await sess_repo.fetch(conn, s.id)
    assert fetched is not None
    assert HIGH_RISK_DIRECTIVE in fetched.research_plan.preferences
    assert fetched.research_plan.preferences[0] == "favor testable ideas"

    # Re-applying must not duplicate the directive.
    await sup._apply_plan(conn, s, plan)
    assert plan.preferences.count(HIGH_RISK_DIRECTIVE) == 1


@pytest.mark.asyncio
async def test_high_risk_off_leaves_preferences_untouched(tmp_cfg, conn) -> None:
    assert tmp_cfg.run.high_risk is False  # default
    sup = Supervisor(tmp_cfg)
    s = _session("ses_hr_off")
    await sess_repo.insert(conn, s)
    plan = ResearchPlan(objective="x", preferences=["favor testable ideas"])

    await sup._apply_plan(conn, s, plan)

    fetched = await sess_repo.fetch(conn, s.id)
    assert fetched is not None
    assert HIGH_RISK_DIRECTIVE not in fetched.research_plan.preferences
