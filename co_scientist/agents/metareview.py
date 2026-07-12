"""Meta-review agent — periodic system feedback + final research overview.

Two actions:
- `GenerateSystemFeedback`           — Sonnet + thinking; writes a SystemFeedback row.
  The body is auto-injected into future Generation/Evolution prompts via the
  `latest_system_feedback` query the agents already perform.
- `GenerateFinalResearchOverview`    — Opus + max thinking; writes the markdown
  report and updates `sessions.final_overview`.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from .. import ids
from ..llm.anthropic_client import AgentCallSpec, CachedBlock, CallContext
from ..llm.prompts import render
from ..llm.routing import route
from ..logging import get_logger
from ..models import SystemFeedback, Task, TaskResult
from ..storage.artifacts import write_json, write_text
from ..storage.repos import feedback as fb_repo
from ..storage.repos import hypotheses as hyp_repo
from ..storage.repos import reviews as rev_repo
from ..storage.repos import sessions as sess_repo
from ..storage.repos import tournaments as tourney_repo
from .base import BaseAgent
from .schemas import RECORD_SYSTEM_FEEDBACK_TOOL

log = get_logger("metareview")


def _mm_id(s: str) -> str:
    return "n" + "".join(c for c in s if c.isalnum())


def _mm_label(s: str) -> str:
    return s.replace('"', " ").replace("\n", " ")[:30]


def _cell(s: str) -> str:
    """Escape GFM table-cell delimiters so a '|' in a title can't shift columns."""
    return s.replace("|", "\\|")


def _analysis_block(top: list, reviews_by_hyp: dict) -> str:
    """Deterministic figures section rendered by the frontend Markdown component:
    a scorecard table + a ```chart scores block + a strategy-mix donut + a
    ```mermaid lineage graph + a KaTeX rating-model formula. Mirrors the shared
    subset of frontend/src/lib/sim/content.ts buildAnalysis; the in-browser demo
    additionally shows an Elo-trajectory chart (it has full match history in
    hand, which this path would need to fetch)."""
    scored = []
    for h in top[:5]:
        sc = next((r.scores for r in reviews_by_hyp.get(h.id, []) if r.scores), None)
        if sc is not None:
            scored.append((h, sc))

    parts = ["## Analysis"]

    if scored:
        rows = "\n".join(
            f"| {i + 1}. {_cell(h.title[:40])} | {sc.novelty:.2f} | {sc.correctness:.2f} "
            f"| {sc.testability:.2f} | {sc.feasibility:.2f} |"
            for i, (h, sc) in enumerate(scored)
        )
        spec = {
            "type": "scores", "title": "Reviewer scores by proposal",
            "proposals": [
                {"label": f"{i + 1}. {h.title[:32]}", "scores": {
                    "novelty": sc.novelty, "correctness": sc.correctness,
                    "testability": sc.testability, "feasibility": sc.feasibility}}
                for i, (h, sc) in enumerate(scored)
            ],
        }
        parts.append(
            "### Proposal scorecard\n\n"
            "Reviewer scores for each finalist (0–1; higher is better).\n\n"
            "| Proposal | Novelty | Correctness | Testability | Feasibility |\n"
            "|---|---|---|---|---|\n" + rows + "\n\n"
            "```chart\n" + json.dumps(spec) + "\n```"
        )

    # Strategy mix across the top hypotheses → donut.
    strat_counts: dict = {}
    for h in top[:5]:
        strat_counts[h.strategy] = strat_counts.get(h.strategy, 0) + 1
    if strat_counts:
        entries = sorted(strat_counts.items(), key=lambda kv: -kv[1])
        srows = "\n".join(f"| {k} | {v} |" for k, v in entries)
        dspec = {"type": "donut", "title": "Hypotheses by generation strategy",
                 "segments": [{"label": k, "value": v} for k, v in entries]}
        parts.append(
            "### Where the ideas came from\n\n"
            "| Generation strategy | Hypotheses |\n|---|---|\n" + srows + "\n\n"
            "```chart\n" + json.dumps(dspec) + "\n```"
        )

    # Lineage over the top hypotheses (edges kept only within the shown set).
    ids_shown = {h.id for h in top[:5]}
    nodes = "\n".join(f'  {_mm_id(h.id)}["{_mm_label(h.title)}"]' for h in top[:5])
    edges = "\n".join(
        f"  {_mm_id(p)} --> {_mm_id(h.id)}"
        for h in top[:5] for p in (h.parent_ids or []) if p in ids_shown
    )
    if nodes:
        parts.append(
            "### Idea lineage\n\n"
            "Original hypotheses and the offspring the Evolution agent bred from "
            "top parents.\n\n"
            "```mermaid\ngraph LR\n" + nodes + ("\n" + edges if edges else "") + "\n```"
        )

    parts.append(
        "### Rating model\n\n"
        "Each match updates a hypothesis's Elo rating $R$ by\n\n"
        r"$$R'_a = R_a + K\,(S_a - E_a), \qquad "
        r"E_a = \frac{1}{1 + 10^{(R_b - R_a)/400}}$$"
        "\n\nwhere $S_a \\in \\{0, 1\\}$ is the match outcome for idea $a$ against "
        "idea $b$, and $K$ is the update rate (larger for newer ideas)."
    )
    return "\n\n".join(parts)


class MetaReviewAgent(BaseAgent):
    name = "metareview"

    async def execute(self, task: Task) -> TaskResult:
        if task.action == "GenerateSystemFeedback":
            return await self._system_feedback(task)
        if task.action == "GenerateFinalResearchOverview":
            return await self._final_overview(task)
        raise ValueError(f"MetaReviewAgent does not handle action {task.action!r}")

    # ----------------------------- system feedback ----------------------------- #

    async def _system_feedback(self, task: Task) -> TaskResult:
        session = await sess_repo.fetch(self.deps.db, task.session_id)
        if session is None:
            raise RuntimeError(f"session {task.session_id} missing")

        reviews = await rev_repo.list_for_session(self.deps.db, session.id)
        if not reviews:
            return TaskResult(kind="noop", extra={"reason": "no reviews yet"})

        reviews_block = "\n\n---\n\n".join(
            f"### Review of `{r.hypothesis_id}` (kind={r.kind}, verdict={r.verdict or '?'})\n{r.body[:3000]}"
            for r in reviews[:50]
        )
        rationales = await tourney_repo.recent_rationales(self.deps.db, session.id, limit=50)
        debate_block = "\n\n---\n\n".join(rat[:1500] for rat in rationales if rat)

        prompt = render(
            "metareview.system",
            goal=session.research_plan.objective,
            preferences="; ".join(session.research_plan.preferences),
            reviews=reviews_block,
            debate_rationales=debate_block,
        )
        r = route(self.deps.cfg, "metareview", "system")
        spec = AgentCallSpec(
            route=r,
            system_blocks=[
                CachedBlock(self._system_prompt_header(), cache=True),
                CachedBlock(
                    f"# Research goal\n{session.research_goal}\n\n"
                    f"# Preferences\n{'; '.join(session.research_plan.preferences)}",
                    cache=True,
                ),
            ],
            user_blocks=[CachedBlock(prompt, cache=False)],
            tools=[RECORD_SYSTEM_FEEDBACK_TOOL],
            tool_choice={"type": "tool", "name": "record_system_feedback"},
            max_output_tokens=4096,
        )
        ctx = CallContext(
            session_id=session.id, task_id=task.id,
            agent="metareview", action="GenerateSystemFeedback", mode="system",
        )
        resp = await self.deps.llm.call(spec, ctx)
        record = self._final_tool_use(resp, "record_system_feedback")
        if record is None:
            return TaskResult(kind="noop", extra={"reason": "no record_system_feedback"})

        narrative = record.get("narrative") or ""
        if record.get("common_weaknesses"):
            narrative += "\n\n**Common weaknesses:** " + "; ".join(record["common_weaknesses"])
        if record.get("common_strengths"):
            narrative += "\n\n**Common strengths:** " + "; ".join(record["common_strengths"])
        if record.get("suggested_focus_areas"):
            narrative += "\n\n**Suggested focus:** " + "; ".join(record["suggested_focus_areas"])

        fb_id = ids.feedback_id()
        artifact_path = await write_json(
            self.deps.cfg, session.id, "system_feedback", fb_id, record
        )
        await fb_repo.insert(self.deps.db, SystemFeedback(
            id=fb_id, session_id=session.id, created_at=datetime.now(UTC),
            source="meta_review", kind="system_feedback",
            target_id=None, text=narrative.strip()[:8000],
            artifact_path=artifact_path, active=True,
        ))
        return TaskResult(
            kind="system_feedback_generated",
            extra={"feedback_id": fb_id, "n_reviews": len(reviews)},
        )

    # ----------------------------- final overview ----------------------------- #

    async def _final_overview(self, task: Task) -> TaskResult:
        session = await sess_repo.fetch(self.deps.db, task.session_id)
        if session is None:
            raise RuntimeError(f"session {task.session_id} missing")

        top = await hyp_repo.top_by_elo(self.deps.db, session.id, k=10)
        all_hyps = await hyp_repo.list_for_session(self.deps.db, session.id)
        if not top and not all_hyps:
            return TaskResult(kind="noop", extra={"reason": "no hypotheses"})
        if not top:
            top = all_hyps[:10]

        # Fetch all reviews for the session in one query, then group by
        # hypothesis_id. Beats N+1 list_for_hypothesis() calls for top-K.
        reviews_by_hyp: dict[str, list] = {}
        for rv in await rev_repo.list_for_session(self.deps.db, session.id):
            reviews_by_hyp.setdefault(rv.hypothesis_id, []).append(rv)

        # Build the top-hypotheses block: summary + best review + winning rationale
        chunks: list[str] = []
        for h in top:
            review_lines: list[str] = []
            for r in reviews_by_hyp.get(h.id, []):
                review_lines.append(
                    f"  - {r.kind}: verdict={r.verdict or '?'} "
                    f"(n={r.scores.novelty}, c={r.scores.correctness}, t={r.scores.testability})"
                )
            elo_s = f"{h.elo:.0f}" if h.elo is not None else "—"
            chunks.append(
                f"### `{h.id}` (Elo {elo_s}, strategy `{h.strategy}`)\n"
                f"**Title.** {h.title}\n\n"
                f"{h.summary}\n\n"
                f"**Reviews:**\n" + ("\n".join(review_lines) or "  (none)")
            )
        top_block = "\n\n---\n\n".join(chunks)

        latest_fb = await fb_repo.latest_system_feedback(self.deps.db, session.id)

        prompt = render(
            "metareview.final",
            goal=session.research_plan.objective,
            preferences="; ".join(session.research_plan.preferences),
            system_feedback=latest_fb.text if latest_fb else "",
            top_hypotheses_block=top_block,
        )
        r = route(self.deps.cfg, "metareview", "final")
        spec = AgentCallSpec(
            route=r,
            system_blocks=[
                CachedBlock(self._system_prompt_header(), cache=True),
                CachedBlock(
                    f"# Research goal\n{session.research_goal}\n\n"
                    f"# Preferences\n{'; '.join(session.research_plan.preferences)}",
                    cache=True,
                ),
            ],
            user_blocks=[CachedBlock(prompt, cache=False)],
            tools=[],            # No tools — write the markdown directly
            tool_choice=None,
            max_output_tokens=16384,   # detailed research-proposal document
        )
        ctx = CallContext(
            session_id=session.id, task_id=task.id,
            agent="metareview", action="GenerateFinalResearchOverview", mode="final",
        )
        resp = await self.deps.llm.call(spec, ctx)
        text = self._final_text(resp)
        if not text.strip():
            text = "# Research overview\n\n_(No content was generated; see transcripts.)_"

        # Append a deterministic figures section (scorecard + chart + lineage +
        # rating-model math) built from real data — always correct regardless of
        # the LLM's prose. Rendered on-site as SVG/Mermaid/KaTeX; copies as
        # markdown (table + fenced blocks).
        text = text.rstrip() + "\n\n" + _analysis_block(top, reviews_by_hyp)

        overview_path = await write_text(
            self.deps.cfg, session.id, "final", "overview", ".md", text
        )
        return TaskResult(
            kind="final_overview_generated",
            extra={"overview_path": overview_path, "n_top": len(top)},
        )
