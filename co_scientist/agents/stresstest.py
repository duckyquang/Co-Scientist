"""Stress-test agent — adversarial probe of a tournament finalist, then a fix.

Two actions, both driven inline by the Supervisor's finalize stage:

- `StressTestHypothesis` — Opus + thinking + a bounded tool loop that actively
  hunts contradicting evidence, verifies the hypothesis's citations, sanity-
  checks feasibility numbers, and designs a *prototype-scale* pilot experiment.
  Persists a `Review(kind="stress_test")` row (for the drawer) and a
  `SystemFeedback(kind="stress_test", target_id=hyp)` row (for the chat feed,
  with the visible thinking).

- `ApplyStressFixes` — turns the stress findings into a revised child
  hypothesis (`strategy="feedback_driven"`, `parent_ids=[tested id]`), reusing
  the Evolution agent's persist/dedup machinery.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from .. import ids
from ..llm.anthropic_client import AgentCallSpec, CachedBlock, CallContext
from ..llm.prompts import render
from ..llm.routing import route
from ..llm.tool_loop import ToolLoopExhausted, run_tool_loop
from ..logging import get_logger
from ..models import Review, ReviewScores, SystemFeedback, Task, TaskResult
from ..safety.quoting import quote_hypothesis
from ..storage.artifacts import write_json
from ..storage.repos import feedback as fb_repo
from ..storage.repos import hypotheses as hyp_repo
from ..storage.repos import reviews as rev_repo
from ..storage.repos import sessions as sess_repo
from .base import BaseAgent
from .metareview import citations_prompt_block, hydrate_citations
from .schemas import RECORD_HYPOTHESIS_TOOL, RECORD_STRESS_TEST_TOOL

log = get_logger("stresstest")


class StressTestAgent(BaseAgent):
    name = "stresstest"

    async def execute(self, task: Task) -> TaskResult:
        if task.action == "StressTestHypothesis":
            return await self._stress_test(task)
        if task.action == "ApplyStressFixes":
            return await self._apply_fix(task)
        raise ValueError(f"StressTestAgent does not handle action {task.action!r}")

    # ----------------------------- stress test ----------------------------- #

    async def _stress_test(self, task: Task) -> TaskResult:
        hypothesis_id = task.target_id
        if not hypothesis_id:
            raise ValueError("StressTestHypothesis requires target_id")

        session = await sess_repo.fetch(self.deps.db, task.session_id)
        if session is None:
            raise RuntimeError(f"session {task.session_id} missing")
        h = await hyp_repo.fetch(self.deps.db, hypothesis_id)
        if h is None:
            raise RuntimeError(f"hypothesis {hypothesis_id} missing")

        reviews = await rev_repo.list_for_hypothesis(self.deps.db, h.id)
        reviews_block = "\n\n---\n\n".join(
            f"### {r.kind} (verdict={r.verdict or '?'})\n{r.body[:2000]}" for r in reviews
        ) or "(none)"
        cites = await hydrate_citations(self.deps.cfg, [h])

        prompt = render(
            "stresstest.probe",
            goal=session.research_plan.objective,
            preferences="; ".join(session.research_plan.preferences),
            hypothesis_id=h.id,
            hypothesis_text=quote_hypothesis(h.full_text, id_=h.id),
            reviews_block=reviews_block,
            citations_block=citations_prompt_block(cites),
        )
        sys_blocks = [
            CachedBlock(self._system_prompt_header(), cache=True),
            CachedBlock(
                f"# Research goal\n{session.research_goal}\n\n"
                f"# Preferences\n{'; '.join(session.research_plan.preferences)}",
                cache=True,
            ),
        ]
        r = route(self.deps.cfg, "stresstest", "probe")
        tools = [*self.deps.tools.anthropic_tools_for("stresstest"), RECORD_STRESS_TEST_TOOL]
        spec = AgentCallSpec(
            route=r,
            system_blocks=sys_blocks,
            user_blocks=[CachedBlock(prompt, cache=False)],
            tools=tools,
            tool_choice={"type": "auto"},   # keep extended thinking enabled
            max_output_tokens=12288,        # must exceed the thinking budget
        )
        ctx = CallContext(
            session_id=session.id, task_id=task.id,
            agent="stresstest", action="StressTestHypothesis", mode="probe",
        )
        try:
            loop = await run_tool_loop(
                self.deps.llm, spec=spec, ctx=ctx,
                registry=self.deps.tools,
                max_iters=self.deps.cfg.tool_loop.stresstest_max_iters,
                parallel_cap=self.deps.cfg.tool_loop.parallel_cap,
                tool_timeout_s=self.deps.cfg.tool_loop.tool_timeout_seconds,
                force_terminal_tool="record_stress_test",
            )
        except ToolLoopExhausted as e:
            log.warning("stresstest_tool_loop_exhausted", err=str(e), hypothesis_id=h.id)
            return TaskResult(kind="noop", extra={"reason": "tool loop exhausted"})

        record = self._final_tool_use(loop.response, "record_stress_test")
        if record is None:
            return TaskResult(kind="noop", extra={"reason": "no record_stress_test"})

        # Honesty filter: drop contradicting-evidence entries whose URL we never
        # actually fetched (same guard Reflection applies to its evidence).
        seen = loop.seen_urls
        record["contradicting_evidence"] = [
            e for e in record.get("contradicting_evidence", [])
            if isinstance(e, dict) and e.get("url") in seen
        ]

        thinking = self._thinking_text(loop.response)
        verdict = record.get("verdict") or "survives"
        report = _render_stress_md(record)

        review_id = ids.review_id(h.id, "stress_test", iteration=0)
        artifact_path = await write_json(
            self.deps.cfg, session.id, "reviews", review_id,
            {"hypothesis_id": h.id, "thinking": thinking, "record": record},
        )
        await rev_repo.insert(self.deps.db, Review(
            id=review_id, hypothesis_id=h.id, session_id=session.id,
            created_at=datetime.now(UTC), kind="stress_test",
            verdict=verdict,                                 # type: ignore[arg-type]
            scores=ReviewScores(
                correctness=record.get("correctness"),
                testability=record.get("testability"),
                feasibility=record.get("feasibility"),
            ),
            body=report, artifact_path=artifact_path,
        ))

        # Contract feedback row for the chat feed (thinking + report).
        text = ""
        if thinking:
            text += f"## Thinking\n\n{thinking[:4000]}\n\n"
        text += f"## Stress test\n\n{report}"
        fb_id = ids.feedback_id()
        await fb_repo.insert(self.deps.db, SystemFeedback(
            id=fb_id, session_id=session.id, created_at=datetime.now(UTC),
            source="meta_review", kind="stress_test",
            target_id=h.id, text=text[:8000],
            artifact_path=artifact_path, active=True,
        ))

        return TaskResult(
            kind="stress_test_completed",
            hypothesis_ids=[h.id],
            review_ids=[review_id],
            extra={
                "verdict": verdict,
                "fix_directives": record.get("fix_directives") or [],
                "report": report,
                "feedback_id": fb_id,
            },
        )

    # ----------------------------- apply fix ----------------------------- #

    async def _apply_fix(self, task: Task) -> TaskResult:
        hypothesis_id = task.target_id
        if not hypothesis_id:
            raise ValueError("ApplyStressFixes requires target_id")

        session = await sess_repo.fetch(self.deps.db, task.session_id)
        if session is None:
            raise RuntimeError(f"session {task.session_id} missing")
        h = await hyp_repo.fetch(self.deps.db, hypothesis_id)
        if h is None:
            raise RuntimeError(f"hypothesis {hypothesis_id} missing")

        fixes = task.payload.get("fix_directives") or []
        prompt = render(
            "stresstest.fix",
            goal=session.research_plan.objective,
            preferences="; ".join(session.research_plan.preferences),
            hypothesis_id=h.id,
            hypothesis_text=quote_hypothesis(h.full_text, id_=h.id),
            verdict=task.payload.get("verdict", ""),
            stress_report=task.payload.get("report", ""),
            fix_directives="\n".join(f"- {d}" for d in fixes),
        )
        sys_blocks = [
            CachedBlock(self._system_prompt_header(), cache=True),
            CachedBlock(
                f"# Research goal\n{session.research_goal}\n\n"
                f"# Preferences\n{'; '.join(session.research_plan.preferences)}",
                cache=True,
            ),
        ]
        r = route(self.deps.cfg, "stresstest", "fix")
        tools = [*self.deps.tools.anthropic_tools_for("stresstest"), RECORD_HYPOTHESIS_TOOL]
        spec = AgentCallSpec(
            route=r,
            system_blocks=sys_blocks,
            user_blocks=[CachedBlock(prompt, cache=False)],
            tools=tools,
            tool_choice={"type": "auto"},
            max_output_tokens=8192,         # must exceed the thinking budget
        )
        ctx = CallContext(
            session_id=session.id, task_id=task.id,
            agent="stresstest", action="ApplyStressFixes", mode="fix",
        )
        try:
            loop = await run_tool_loop(
                self.deps.llm, spec=spec, ctx=ctx,
                registry=self.deps.tools,
                max_iters=self.deps.cfg.tool_loop.stresstest_max_iters,
                parallel_cap=self.deps.cfg.tool_loop.parallel_cap,
                tool_timeout_s=self.deps.cfg.tool_loop.tool_timeout_seconds,
                force_terminal_tool="record_hypothesis",
            )
        except ToolLoopExhausted as e:
            log.warning("stress_fix_tool_loop_exhausted", err=str(e), hypothesis_id=h.id)
            return TaskResult(kind="noop", extra={"reason": "tool loop exhausted"})

        record = self._final_tool_use(loop.response, "record_hypothesis")
        if record is None:
            return TaskResult(kind="noop", extra={"reason": "no record_hypothesis"})

        record["citations"] = [
            c for c in record.get("citations", [])
            if isinstance(c, dict) and c.get("url") in loop.seen_urls
        ]
        record["strategy"] = "feedback_driven"
        record["parent_ids"] = [h.id]

        # Reuse Evolution's content-derived id + FAISS dedup + insert path.
        from .evolution import EvolutionAgent

        new_id, was_new = await EvolutionAgent(self.deps)._persist(
            session.id, record, strategy="feedback_driven"
        )
        return TaskResult(
            kind="hypothesis_created",
            hypothesis_ids=[new_id] if was_new else [],
            extra={"parent": h.id, "child_id": new_id, "deduped": not was_new},
        )


def _render_stress_md(record: dict[str, Any]) -> str:
    parts: list[str] = [f"**Verdict.** {record.get('verdict', '?')}"]

    ce = record.get("contradicting_evidence") or []
    parts.append("## Contradicting evidence sought")
    if ce:
        for e in ce:
            parts.append(f"- {e.get('claim', '')} — {e.get('url', '')}\n  > {e.get('excerpt', '')}")
    else:
        parts.append("- None found in an honest search.")

    cc = record.get("citation_checks") or []
    if cc:
        parts.append("## Citation checks")
        for c in cc:
            ok = "supports" if c.get("supports_claim") else "does NOT support"
            parts.append(f"- `{c.get('url', '')}` — {ok}: {c.get('note', '')}")

    if record.get("feasibility_check"):
        parts.append(f"## Feasibility\n{record['feasibility_check']}")

    pe = record.get("pilot_experiment") or {}
    if pe:
        parts.append(
            "## Prototype-scale pilot\n"
            f"- **Model system.** {pe.get('model_system', '')}\n"
            f"- **Intervention.** {pe.get('intervention', '')}\n"
            f"- **Readout.** {pe.get('readout', '')}\n"
            f"- **Success criterion.** {pe.get('success_criterion', '')}\n"
            f"- **Scale (pilot bounds).** {pe.get('scale', '')}"
        )

    fixes = record.get("fix_directives") or []
    if fixes:
        parts.append("## Fixes to apply\n" + "\n".join(f"- {d}" for d in fixes))

    if record.get("notes"):
        parts.append(f"## Notes\n{record['notes']}")
    return "\n\n".join(parts)
