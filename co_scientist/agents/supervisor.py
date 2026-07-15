"""Supervisor — durable task scheduler for the multi-agent system.

Responsibilities:
1. Parse the scientist's goal into a ResearchPlan.
2. Bootstrap the session (insert row, reclaim expired leases on resume).
3. Run a bounded asyncio worker pool that claims tasks from the DB-backed queue.
4. Apply follow-up scheduling rules after each task completes.
5. Periodically run `decide_next_steps` when the queue is idle:
   - Tournament refinement.
   - Evolution if the leaderboard is stable.
   - Periodic system-feedback meta-reviews.
6. Check the termination predicate after every task; on stop, cancel pending
   work and run a single final meta-review for the overview.
7. Honor pause / abort via DB-flagged session.status.
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import UTC, datetime
from typing import Any

import aiosqlite

from .. import ids
from ..config import Config
from ..llm.anthropic_client import (
    AgentCallSpec,
    CachedBlock,
    CallContext,
)
from ..llm.budgets import TokenBudget
from ..llm.prompts import render
from ..llm.provider import get_provider
from ..llm.routing import route
from ..logging import bind, get_logger
from ..models import ResearchPlan, Session, SystemFeedback, Task
from ..orchestrator.events import GLOBAL_BUS
from ..orchestrator.termination import (
    StabilityTracker,
    StopReason,
    should_stop,
    snapshot_top_k,
)
from ..storage import db as db_mod
from ..storage.artifacts import write_text
from ..storage.repos import events as events_repo
from ..storage.repos import feedback as fb_repo
from ..storage.repos import hypotheses as hyp_repo
from ..storage.repos import reviews as rev_repo
from ..storage.repos import sessions as sess_repo
from ..storage.repos import tasks as task_repo
from ..tools.registry import ToolRegistry
from .base import AgentDeps
from .generation import GenerationAgent
from .ranking import RankingAgent
from .reflection import ReflectionAgent
from .schemas import RECORD_RESEARCH_PLAN_TOOL

log = get_logger("supervisor")

# Injected into plan.preferences when cfg.run.high_risk is set; the existing
# {{ preferences }} interpolation carries it to generation, reflection,
# evolution (incl. out_of_box) and ranking — no prompt-template edits needed.
HIGH_RISK_DIRECTIVE = (
    "HIGH-RISK MODE: strongly favor bold, unconventional, contrarian hypotheses "
    "that break from established framings; do NOT recycle or merely recombine "
    "already-proposed methods; propose novel mechanisms over incremental "
    "variations, even at higher failure risk."
)


# ----------------------------- public API ----------------------------- #


class Supervisor:
    """One-process Supervisor; CLI invokes via `await supervisor.run_session(...)`."""

    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg

    async def run_session(
        self,
        goal: str,
        *,
        preferences_text: str | None = None,
        n_initial: int = 3,
        wall_clock_seconds: int | None = None,
        resume_session_id: str | None = None,
    ) -> str:
        conn = await db_mod.connect(self.cfg)
        try:
            if resume_session_id is None:
                session = await self._create_session(conn, goal, preferences_text, wall_clock_seconds)
                bind(session_id=session.id)
                log.info(
                    "session_started",
                    goal=goal[:120], session_id=session.id,
                    budget_usd=session.budget_usd, n_initial=n_initial,
                )
                await self._emit(conn, session.id, "session_started", {
                    "goal": goal[:200], "n_initial": n_initial,
                    "budget_usd": session.budget_usd,
                })
                budget = TokenBudget(
                    cfg=self.cfg,
                    budget_tokens=session.budget_tokens,
                    budget_usd=session.budget_usd,
                )
                llm = get_provider(self.cfg, db=conn, budget=budget)
                tools = ToolRegistry(self.cfg).discover()
                deps = AgentDeps(cfg=self.cfg, db=conn, llm=llm, tools=tools)

                plan = await self._parse_goal(deps, session, goal, preferences_text)
                await self._apply_plan(conn, session, plan)
                session = await sess_repo.fetch(conn, session.id)
                assert session is not None

                for i in range(n_initial):
                    await task_repo.enqueue(conn, Task(
                        id=ids.task_id(), session_id=session.id,
                        created_at=datetime.now(UTC),
                        agent="generation", action="CreateInitialHypotheses",
                        payload={"strategy": "literature", "n": 1},
                        priority=100, status="pending",
                        idempotency_key=f"{session.id}::generation::initial::{i}",
                    ))
            else:
                session = await sess_repo.fetch(conn, resume_session_id)
                if session is None:
                    raise RuntimeError(f"no such session: {resume_session_id}")
                bind(session_id=session.id)
                log.info("session_resumed", session_id=session.id, status=session.status)
                reclaimed = await task_repo.reclaim_expired_leases(
                    conn, session.id, max_attempts=self.cfg.lease.max_attempts,
                )
                log.info("leases_reclaimed", **reclaimed)
                if session.status not in ("running", "paused"):
                    await sess_repo.set_status(conn, session.id, "running")
                budget = TokenBudget(
                    cfg=self.cfg,
                    budget_tokens=session.budget_tokens,
                    budget_usd=session.budget_usd,
                )
                llm = get_provider(self.cfg, db=conn, budget=budget)
                tools = ToolRegistry(self.cfg).discover()
                deps = AgentDeps(cfg=self.cfg, db=conn, llm=llm, tools=tools)

            tracker = StabilityTracker(
                k=self.cfg.termination.elo_stability_k,
                n=self.cfg.termination.elo_stability_n,
                eps=self.cfg.termination.elo_stability_eps,
            )

            stop_reason = await self._main_loop(conn, deps, session, tracker)
            log.info("main_loop_exit", stop_reason=stop_reason.value if stop_reason else "none")

            await self._finalize(conn, deps, session, stop_reason)
            return session.id
        finally:
            await conn.close()

    # ----------------------------- session bootstrap ----------------------------- #

    async def _create_session(
        self,
        conn: aiosqlite.Connection,
        goal: str,
        preferences_text: str | None,
        wall_clock_seconds: int | None,
    ) -> Session:
        sid = ids.session_id()
        now = datetime.now(UTC)
        wall = wall_clock_seconds or self.cfg.run.wall_clock_seconds
        from datetime import timedelta

        plan = ResearchPlan(objective=goal.strip(), preferences=[], idea_attributes=[])
        snap: dict[str, Any] = json.loads(json.dumps(self.cfg.model_dump(exclude={"secrets"})))
        s = Session(
            id=sid, created_at=now, updated_at=now, status="running",
            research_goal=goal, research_plan=plan,
            config_snapshot=snap,
            budget_tokens=self.cfg.run.budget_tokens, budget_usd=self.cfg.run.budget_usd,
            wall_deadline=now + timedelta(seconds=wall),
        )
        await sess_repo.insert(conn, s)
        if preferences_text:
            await fb_repo.insert(conn, _human_preference(s.id, preferences_text))
        return s

    async def _parse_goal(
        self,
        deps: AgentDeps,
        session: Session,
        goal: str,
        preferences_text: str | None,
    ) -> ResearchPlan:
        prompt = render(
            "parse_goal", goal=goal,
            preferences_text=preferences_text or "",
        )
        r = route(self.cfg, "parse_goal", None)
        spec = AgentCallSpec(
            route=r,
            system_blocks=[CachedBlock("You parse research goals into structured plans.", cache=True)],
            user_blocks=[CachedBlock(prompt, cache=False)],
            tools=[RECORD_RESEARCH_PLAN_TOOL],
            tool_choice={"type": "tool", "name": "record_research_plan"},
            max_output_tokens=1024,
        )
        ctx = CallContext(
            session_id=session.id, task_id=None,
            agent="parse_goal", action="parse_goal", mode=None,
        )
        resp = await deps.llm.call(spec, ctx)
        record: dict[str, Any] | None = None
        for b in resp.raw.content:
            if getattr(b, "type", None) == "tool_use" and getattr(b, "name", "") == "record_research_plan":
                inp = getattr(b, "input", None)
                if isinstance(inp, dict):
                    record = inp
                    break
        if record is None:
            log.warning("parse_goal_no_record", note="falling back to bare ResearchPlan")
            return ResearchPlan(objective=goal.strip(), preferences=[], idea_attributes=[])
        return ResearchPlan(
            objective=record.get("objective", goal.strip()),
            preferences=record.get("preferences", []),
            constraints=record.get("constraints", []),
            idea_attributes=record.get("idea_attributes", []),
            domain_hint=record.get("domain_hint") or None,
            notes=record.get("notes") or None,
        )

    async def _apply_plan(
        self, conn: aiosqlite.Connection, session: Session, plan: ResearchPlan
    ) -> None:
        if self.cfg.run.high_risk and HIGH_RISK_DIRECTIVE not in plan.preferences:
            plan.preferences.append(HIGH_RISK_DIRECTIVE)
        await conn.execute(
            "UPDATE sessions SET research_plan=?, updated_at=? WHERE id=?",
            (plan.model_dump_json(), datetime.now(UTC).isoformat(), session.id),
        )
        await conn.commit()

    # ----------------------------- main loop ----------------------------- #

    async def _main_loop(
        self,
        conn: aiosqlite.Connection,
        deps: AgentDeps,
        session: Session,
        tracker: StabilityTracker,
    ) -> StopReason | None:
        agents = self._build_agents(deps)
        sem = asyncio.Semaphore(self.cfg.run.concurrency)
        inflight: set[asyncio.Task] = set()
        worker_seq = 0
        last_decide_at = 0.0
        last_snapshot_match_count = -1
        last_tokens = -1
        last_progress_at = time.monotonic()

        async def _run_task(t: Task) -> None:
            bind(session_id=session.id, task_id=t.id, agent=t.agent)
            async with sem:
                await task_repo.mark_in_progress(conn, t.id)
                await self._emit(conn, session.id, "task_started",
                                 {"task_id": t.id, "agent": t.agent, "action": t.action,
                                  "target": t.target_id})
                agent = agents.get(t.agent)
                if agent is None:
                    await task_repo.fail(conn, t.id, error=f"no agent: {t.agent}",
                                          max_attempts=self.cfg.lease.max_attempts)
                    return
                try:
                    result = await agent.execute(t)
                except Exception as e:
                    await task_repo.fail(conn, t.id, error=str(e),
                                          max_attempts=self.cfg.lease.max_attempts)
                    log.exception("task_failed", err=str(e), task_id=t.id, action=t.action)
                    await self._emit(conn, session.id, "task_failed",
                                     {"task_id": t.id, "err": str(e)[:300]})
                    return

                await self._apply_follow_ups(conn, session, t, result)
                await task_repo.complete(conn, t.id)
                await self._emit(conn, session.id, "task_completed",
                                 {"task_id": t.id, "kind": result.kind,
                                  "follow_hypothesis_ids": result.hypothesis_ids[:5]})

        try:
            while True:
                # Check external pause/abort by re-reading session status.
                refreshed = await sess_repo.fetch(conn, session.id)
                external_stop = refreshed is not None and refreshed.status in ("aborted",)
                if refreshed is not None and refreshed.status == "paused":
                    # Wait until unpaused (or aborted). Paused time is not a stall.
                    last_progress_at = time.monotonic()
                    await asyncio.sleep(1.0)
                    continue

                # Termination check (refreshes budget_used_* from the row)
                if refreshed is not None:
                    if refreshed.budget_used_tokens != last_tokens:
                        last_tokens = refreshed.budget_used_tokens
                        last_progress_at = time.monotonic()
                    # `not inflight` keeps one live long-thinking call from
                    # tripping the stall detector.
                    stalled = (
                        not inflight
                        and time.monotonic() - last_progress_at
                        >= self.cfg.termination.stall_after_seconds
                    )
                    stop = should_stop(
                        self.cfg, refreshed, tracker,
                        external_stop=external_stop, stalled=stalled,
                    )
                    if stop is not None:
                        # Wait for inflight to drain before returning.
                        if inflight:
                            await asyncio.wait(inflight)
                        return stop

                # Refill worker slots.
                slots_open = self.cfg.run.concurrency - len(inflight)
                claimed: list[Task] = []
                for _ in range(slots_open):
                    t = await task_repo.claim_one(
                        conn, session.id, worker_id=f"w{worker_seq}",
                        lease_seconds=self.cfg.lease.default_seconds,
                    )
                    if t is None:
                        break
                    worker_seq += 1
                    claimed.append(t)
                for t in claimed:
                    inflight.add(asyncio.create_task(_run_task(t)))

                # Update stability snapshot when match count crossed the threshold.
                snap = await snapshot_top_k(conn, session.id, self.cfg.termination.elo_stability_k)
                if (
                    snap.match_count >= last_snapshot_match_count + self.cfg.termination.match_snapshot_every
                ):
                    tracker.push(snap)
                    last_snapshot_match_count = snap.match_count
                    log.info(
                        "elo_snapshot", match_count=snap.match_count,
                        top_ids=list(snap.top_ids), top_elos=list(snap.top_elos),
                    )

                # If nothing to do at all and the queue is empty, run decide_next_steps
                # at most every ~10s, else exit (only if we have no hypotheses yet either).
                if not inflight and not claimed:
                    pending = await task_repo.count_by_status(conn, session.id)
                    if pending.get("pending", 0) == 0:
                        now = time.monotonic()
                        if now - last_decide_at >= 10.0:
                            last_decide_at = now
                            scheduled = await self._decide_next_steps(conn, session)
                            if scheduled == 0:
                                # truly idle and no progress possible — exit gracefully
                                return StopReason.IDLE
                            continue
                        # Wait briefly so we don't spin
                        await asyncio.sleep(1.0)
                        continue

                if not inflight:
                    # Nothing claimed AND nothing running — but tasks may be pending
                    # in other workers' future claims; brief sleep and retry.
                    await asyncio.sleep(0.1)
                    continue

                _done, pending = await asyncio.wait(
                    inflight, return_when=asyncio.FIRST_COMPLETED
                )
                inflight = set(pending)
        finally:
            if inflight:
                # Best effort: let any inflight task finish before returning.
                await asyncio.wait(inflight)

    # ----------------------------- follow-up rules ----------------------------- #

    async def _apply_follow_ups(
        self,
        conn: aiosqlite.Connection,
        session: Session,
        task: Task,
        result,
    ) -> None:
        if result.kind == "hypothesis_created":
            for hid in result.hypothesis_ids:
                await task_repo.enqueue(conn, Task(
                    id=ids.task_id(), session_id=session.id,
                    created_at=datetime.now(UTC),
                    agent="reflection", action="ReviewHypothesis",
                    target_id=hid, payload={"kind": "full"},
                    priority=100, status="pending",
                    idempotency_key=f"{hid}::review::full",
                ))
        elif result.kind == "review_completed":
            for hid in result.hypothesis_ids:
                await task_repo.enqueue(conn, Task(
                    id=ids.task_id(), session_id=session.id,
                    created_at=datetime.now(UTC),
                    agent="ranking", action="AddToTournament",
                    target_id=hid, payload={}, priority=80, status="pending",
                    idempotency_key=f"{hid}::ranking::add",
                ))
        elif result.kind == "added_to_tournament":
            for hid in result.hypothesis_ids:
                await task_repo.enqueue(conn, Task(
                    id=ids.task_id(), session_id=session.id,
                    created_at=datetime.now(UTC),
                    agent="ranking", action="RunTournamentBatch",
                    target_id=None,
                    payload={"focus": hid}, priority=120, status="pending",
                    idempotency_key=f"{hid}::ranking::focus_batch",
                ))
        elif result.kind == "self_critique_generated":
            # Re-scrutinize the current leaders with fresh full reviews.
            rnd = result.extra.get("round", 0)
            for h in await hyp_repo.top_by_elo(conn, session.id, k=3):
                await task_repo.enqueue(conn, Task(
                    id=ids.task_id(), session_id=session.id,
                    created_at=datetime.now(UTC),
                    agent="reflection", action="ReviewHypothesis",
                    target_id=h.id, payload={"kind": "full"},
                    priority=125, status="pending",
                    idempotency_key=f"{h.id}::review::full::critique{rnd}",
                ))
        elif result.kind == "tournament_match_complete":
            n_matches = result.extra.get("total_matches_after")
            _ = n_matches
            # Periodically re-cluster the proximity graph.
            from ..storage.repos import tournaments as tourney_repo

            mc = await tourney_repo.count_matches(conn, session.id)
            if (
                mc > 0
                and mc % self.cfg.vectors.full_recluster_every_matches == 0
            ):
                await task_repo.enqueue(conn, Task(
                    id=ids.task_id(), session_id=session.id,
                    created_at=datetime.now(UTC),
                    agent="proximity", action="UpdateProximityGraph",
                    target_id=None, payload={"rebuild": True},
                    priority=200, status="pending",
                    idempotency_key=f"{session.id}::proximity::{mc}",
                ))

    # ----------------------------- decide_next_steps ----------------------------- #

    async def _decide_next_steps(
        self, conn: aiosqlite.Connection, session: Session
    ) -> int:
        """When the queue empties: refill it with refinement work. Returns # enqueued."""
        from ..storage.repos import tournaments as tourney_repo

        enqueued = 0

        # We anchor idle-refinement idempotency keys on the current match count
        # rather than a fresh task id. Otherwise every idle pass — which can
        # fire every ~10s — would enqueue a *new* tournament/evolution task
        # even when a prior one is still pending, flooding the queue and
        # double-counting work toward the budget.
        anchor_mc = await tourney_repo.count_matches(conn, session.id)

        # Always: one tournament batch to keep refining Elo.
        in_tournament = await hyp_repo.list_for_session(
            conn, session.id, state="in_tournament"
        )
        # Idempotency-key collisions mean the work is already queued — they must
        # NOT count as newly scheduled, or an idle loop never reaches IDLE.
        if len(in_tournament) >= 2 and await task_repo.enqueue(conn, Task(
            id=ids.task_id(), session_id=session.id,
            created_at=datetime.now(UTC),
            agent="ranking", action="RunTournamentBatch",
            target_id=None, payload={},
            priority=150, status="pending",
            idempotency_key=f"{session.id}::ranking::idle::{anchor_mc}",
        )):
            enqueued += 1

        # If the leaderboard has matured, evolve.
        mature = sum(1 for h in in_tournament if h.matches_played >= 3)
        if mature >= self.cfg.run.evolution_min_mature and await task_repo.enqueue(conn, Task(
            id=ids.task_id(), session_id=session.id,
            created_at=datetime.now(UTC),
            agent="evolution", action="EvolveTopHypotheses",
            target_id=None,
            payload={"top_k": 5, "strategies": ["combine", "simplify", "out_of_box"]},
            priority=140, status="pending",
            idempotency_key=f"{session.id}::evolution::idle::{anchor_mc}",
        )):
            enqueued += 1

        # Recurring self-critique: once per `critique_every_matches` bucket the
        # meta-review agent re-questions the leaderboard (flaws, wrong
        # conclusions, suspect citations) and shows its thinking in the feed.
        crit_every = self.cfg.run.critique_every_matches
        bucket = anchor_mc // crit_every if crit_every > 0 else 0
        if bucket >= 1 and await task_repo.enqueue(conn, Task(
            id=ids.task_id(), session_id=session.id,
            created_at=datetime.now(UTC),
            agent="metareview", action="GenerateSelfCritique",
            target_id=None, payload={"round": bucket},
            priority=130, status="pending",
            idempotency_key=f"{session.id}::metareview::critique::{bucket}",
        )):
            enqueued += 1

        # Periodic meta-review (every ~5 minutes wall, approximated by match count).
        mc = await tourney_repo.count_matches(conn, session.id)
        async with conn.execute(
            """SELECT COUNT(*) AS n FROM system_feedback
                  WHERE session_id=? AND kind='system_feedback' AND source='meta_review'""",
            (session.id,),
        ) as cur:
            row = await cur.fetchone()
        feedback_count = row["n"] if row else 0
        if mc >= (feedback_count + 1) * 50 and await task_repo.enqueue(conn, Task(
            id=ids.task_id(), session_id=session.id,
            created_at=datetime.now(UTC),
            agent="metareview", action="GenerateSystemFeedback",
            target_id=None, payload={},
            priority=180, status="pending",
            idempotency_key=f"{session.id}::metareview::feedback::{feedback_count + 1}",
        )):
            enqueued += 1

        return enqueued

    # ----------------------------- finalize ----------------------------- #

    async def _finalize(
        self,
        conn: aiosqlite.Connection,
        deps: AgentDeps,
        session: Session,
        stop_reason: StopReason | None,
    ) -> None:
        # Stress-test stage runs FIRST (before we cancel pending work) so it
        # executes for every stop reason. Fully best-effort: any failure inside
        # degrades to the next step and never blocks the final overview.
        try:
            await self._run_stress_stage(conn, deps, session)
        except Exception as e:
            log.exception("stress_stage_failed", err=str(e))

        n_cancel = await task_repo.cancel_pending_for_session(conn, session.id)
        if n_cancel:
            log.info("pending_cancelled", n=n_cancel)

        # Try to run the proper final overview via metareview if the agent exists.
        # Fall back to the stub if metareview is not yet wired in (older builds).
        try:
            from .metareview import MetaReviewAgent

            agent = MetaReviewAgent(deps)
            final_task = Task(
                id=ids.task_id(), session_id=session.id,
                created_at=datetime.now(UTC),
                agent="metareview", action="GenerateFinalResearchOverview",
                target_id=None, payload={}, priority=1, status="pending",
                idempotency_key=f"{session.id}::metareview::final",
            )
            await task_repo.enqueue(conn, final_task)
            await task_repo.mark_in_progress(conn, final_task.id)
            try:
                result = await agent.execute(final_task)
                overview_path = result.extra.get("overview_path")
                if overview_path:
                    await sess_repo.set_final_overview(conn, session.id, overview_path)
                await task_repo.complete(conn, final_task.id)
            except Exception as e:
                log.exception("final_overview_failed", err=str(e))
                await task_repo.fail(conn, final_task.id, error=str(e),
                                      max_attempts=self.cfg.lease.max_attempts)
                overview_path = await self._write_simple_overview(conn, session)
                await sess_repo.set_final_overview(conn, session.id, overview_path)
        except ImportError:
            overview_path = await self._write_simple_overview(conn, session)
            await sess_repo.set_final_overview(conn, session.id, overview_path)

        # `set_final_overview` flips status to 'done' atomically. If the
        # overview path was never set (e.g. metareview crashed and the simple
        # overview also failed) the status is still 'running'; force-set it
        # here so the session doesn't appear to be running forever after exit.
        # For EXTERNAL stops we don't overwrite the user-set 'paused' /
        # 'aborted' status.
        if stop_reason != StopReason.EXTERNAL:
            await sess_repo.set_status(conn, session.id, "done")

        await self._emit(conn, session.id, "session_done",
                         {"stop_reason": stop_reason.value if stop_reason else None})

    # ----------------------------- stress-test stage ----------------------------- #

    async def _run_stress_stage(
        self, conn: aiosqlite.Connection, deps: AgentDeps, session: Session
    ) -> None:
        """Stress-test the top-K finalists, apply fixes, then re-rank the 3.

        Every step is wrapped so a failure degrades to the next rather than
        killing finalize. Emits task_started/completed events per inline task.
        """
        top_k = self.cfg.run.stress_test_top_k
        if top_k <= 0:
            return
        agents = self._build_agents(deps)
        stress = agents.get("stresstest")
        if stress is None:
            log.info("stress_stage_skipped", reason="agent unavailable")
            return
        # Idempotent at stage granularity: if a re-rank row already exists (e.g.
        # a resumed session that already finalized), don't re-run the stage.
        if await fb_repo.latest_system_feedback(conn, session.id, kind="stress_ranking"):
            log.info("stress_stage_skipped", reason="already ran")
            return

        refreshed = await sess_repo.fetch(conn, session.id)
        if (
            refreshed is not None and refreshed.budget_tokens > 0
            and refreshed.budget_used_tokens >= refreshed.budget_tokens
        ):
            log.info("stress_stage_skipped", reason="budget exhausted")
            return

        top = await hyp_repo.top_by_elo(conn, session.id, k=top_k)
        if len(top) < 2:
            log.info("stress_stage_skipped", reason="fewer than 2 finalists")
            return

        await self._emit(conn, session.id, "stress_stage_started",
                         {"hypothesis_ids": [h.id for h in top]})

        # Phase 1 — stress test each finalist.
        stress_extra: dict[str, dict[str, Any]] = {}
        for h in top:
            res = await self._inline(conn, session, stress, "stresstest",
                                     "StressTestHypothesis", target_id=h.id)
            if res is not None and res.kind == "stress_test_completed":
                stress_extra[h.id] = res.extra

        # Phase 2 — apply fixes (feedback-driven child) and prime it for ranking.
        # `final_ids` are the 3 ids to re-rank: the fixed child where a fix
        # landed, else the original finalist.
        final_ids: list[str] = []
        fix_of: dict[str, str] = {}         # original id -> child id
        for h in top:
            extra = stress_extra.get(h.id)
            replacement = h.id
            if extra and extra.get("verdict") != "survives" and extra.get("fix_directives"):
                fix_res = await self._inline(
                    conn, session, stress, "stresstest", "ApplyStressFixes",
                    target_id=h.id,
                    payload={
                        "verdict": extra.get("verdict", ""),
                        "report": extra.get("report", ""),
                        "fix_directives": extra.get("fix_directives", []),
                    },
                )
                if (
                    fix_res is not None and fix_res.kind == "hypothesis_created"
                    and fix_res.hypothesis_ids
                ):
                    child = fix_res.hypothesis_ids[0]
                    await self._prime_for_ranking(conn, session, agents, child)
                    replacement = child
                    fix_of[h.id] = child
            final_ids.append(replacement)

        # Phase 3 — re-rank exactly these 3 head-to-head.
        ranking = agents.get("ranking")
        if ranking is not None and len(final_ids) >= 2:
            for _ in range(6):
                await self._inline(conn, session, ranking, "ranking",
                                   "RunTournamentBatch",
                                   payload={"only_ids": final_ids})

        # Phase 4 — the single stress_ranking summary row.
        await self._write_stress_ranking(conn, session, top, final_ids, fix_of, stress_extra)
        await self._emit(conn, session.id, "stress_stage_done",
                         {"final_ids": final_ids})

    async def _inline(
        self,
        conn: aiosqlite.Connection,
        session: Session,
        agent: object,
        agent_name: str,
        action: str,
        *,
        target_id: str | None = None,
        payload: dict[str, Any] | None = None,
    ):
        """Enqueue → mark_in_progress → execute → complete, all inline. Returns
        the TaskResult (or None on failure). Never raises — the stage is
        best-effort."""
        t = Task(
            id=ids.task_id(), session_id=session.id, created_at=datetime.now(UTC),
            agent=agent_name, action=action, target_id=target_id,   # type: ignore[arg-type]
            payload=payload or {}, priority=1, status="pending",
        )
        await task_repo.enqueue(conn, t)
        await task_repo.mark_in_progress(conn, t.id)
        await self._emit(conn, session.id, "task_started",
                         {"task_id": t.id, "agent": agent_name, "action": action,
                          "target": target_id})
        try:
            res = await agent.execute(t)   # type: ignore[attr-defined]
        except Exception as e:
            await task_repo.fail(conn, t.id, error=str(e),
                                  max_attempts=self.cfg.lease.max_attempts)
            log.warning("stress_inline_failed", action=action, target=target_id, err=str(e))
            await self._emit(conn, session.id, "task_failed",
                             {"task_id": t.id, "err": str(e)[:300]})
            return None
        await task_repo.complete(conn, t.id)
        await self._emit(conn, session.id, "task_completed",
                         {"task_id": t.id, "kind": res.kind})
        return res

    async def _prime_for_ranking(
        self, conn: aiosqlite.Connection, session: Session,
        agents: dict[str, object], child_id: str
    ) -> None:
        """Give a fix child a quick review then add it to the tournament so it
        can be re-ranked against the other finalists."""
        reflection = agents.get("reflection")
        if reflection is not None:
            await self._inline(conn, session, reflection, "reflection",
                               "ReviewHypothesis", target_id=child_id,
                               payload={"kind": "full"})
        ranking = agents.get("ranking")
        if ranking is not None:
            await self._inline(conn, session, ranking, "ranking",
                               "AddToTournament", target_id=child_id)

    async def _write_stress_ranking(
        self,
        conn: aiosqlite.Connection,
        session: Session,
        top: list,
        final_ids: list[str],
        fix_of: dict[str, str],
        stress_extra: dict[str, dict[str, Any]],
    ) -> None:
        """Insert the single stress_ranking feedback row summarizing the tested,
        fixed, and re-ranked top ideas (final Elo order)."""
        # Map final id -> (original hyp, final hyp row).
        rows: list[tuple[float, str]] = []
        for orig in top:
            child_id = fix_of.get(orig.id)
            final_id = child_id or orig.id
            final_h = await hyp_repo.fetch(conn, final_id)
            elo = final_h.elo if (final_h and final_h.elo is not None) else (orig.elo or 0.0)
            extra = stress_extra.get(orig.id) or {}
            verdict = extra.get("verdict", "not tested")
            fix_txt = (
                f" Fix applied — revised as `{child_id}`."
                if child_id else " No fix needed."
            )
            line = (
                f"**{orig.title or orig.id}** (`{final_id}`, Elo {elo:.0f}) — "
                f"stress test: _{verdict}_.{fix_txt}"
            )
            rows.append((elo, line))

        rows.sort(key=lambda r: -r[0])
        body = "## Stress-tested final ranking\n\n" + "\n".join(
            f"{i}. {line}" for i, (_, line) in enumerate(rows, 1)
        )
        await fb_repo.insert(conn, SystemFeedback(
            id=ids.feedback_id(), session_id=session.id, created_at=datetime.now(UTC),
            source="meta_review", kind="stress_ranking",
            target_id=None, text=body[:8000], active=True,
        ))

    async def _write_simple_overview(
        self, conn: aiosqlite.Connection, session: Session
    ) -> str:
        hyps = await hyp_repo.list_for_session(conn, session.id)
        parts: list[str] = [
            f"# Research overview — session {session.id}",
            f"\n**Goal.** {session.research_goal}\n",
            f"**Hypotheses produced.** {len(hyps)}",
            "",
        ]
        for i, h in enumerate(hyps, 1):
            parts.append(f"## {i}. {h.title or h.id}")
            parts.append(
                f"`{h.id}` — strategy `{h.strategy}` — state `{h.state}` "
                f"— Elo `{h.elo:.0f}`" if h.elo is not None else
                f"`{h.id}` — strategy `{h.strategy}` — state `{h.state}`"
            )
            parts.append(h.summary or "(no summary)")
            reviews = await rev_repo.list_for_hypothesis(conn, h.id)
            if reviews:
                parts.append("\n**Reviews:**")
                for r in reviews:
                    parts.append(
                        f"- *{r.kind}* — verdict `{r.verdict or '?'}` "
                        f"(n={r.scores.novelty}, c={r.scores.correctness}, "
                        f"t={r.scores.testability})"
                    )
            parts.append("")
        body = "\n".join(parts)
        # Guarantee a References section from the hypotheses' real citations.
        from .metareview import ensure_references, hydrate_citations

        cites = await hydrate_citations(self.cfg, hyps)
        body = ensure_references(body, cites)
        return await write_text(self.cfg, session.id, "final", "overview", ".md", body)

    # ----------------------------- helpers ----------------------------- #

    def _build_agents(self, deps: AgentDeps) -> dict[str, object]:
        out: dict[str, object] = {
            "generation": GenerationAgent(deps),
            "reflection": ReflectionAgent(deps),
            "ranking": RankingAgent(deps),
        }
        # Evolution / Proximity / Meta-review register if importable.
        try:
            from .evolution import EvolutionAgent

            out["evolution"] = EvolutionAgent(deps)
        except ImportError:
            pass
        try:
            from .proximity import ProximityAgent

            out["proximity"] = ProximityAgent(deps)
        except ImportError:
            pass
        try:
            from .metareview import MetaReviewAgent

            out["metareview"] = MetaReviewAgent(deps)
        except ImportError:
            pass
        try:
            from .stresstest import StressTestAgent

            out["stresstest"] = StressTestAgent(deps)
        except ImportError:
            pass
        return out

    async def _emit(
        self,
        conn: aiosqlite.Connection,
        session_id: str,
        event: str,
        payload: dict[str, Any] | None = None,
    ) -> None:
        await events_repo.emit(
            conn, session_id=session_id, task_id=None, agent="supervisor",
            event=event, payload=payload,
        )
        await GLOBAL_BUS.publish(session_id, event, payload)


# ----------------------------- helpers ----------------------------- #


def _human_preference(session_id: str, text: str):
    from ..models import SystemFeedback

    return SystemFeedback(
        id=ids.feedback_id(), session_id=session_id,
        created_at=datetime.now(UTC),
        source="human", kind="preference",
        target_id=None, text=text, active=True,
    )
