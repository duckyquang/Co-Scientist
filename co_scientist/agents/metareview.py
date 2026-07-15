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
import re
from datetime import UTC, datetime

from .. import ids
from ..config import Config
from ..llm.anthropic_client import AgentCallSpec, CachedBlock, CallContext
from ..llm.prompts import render
from ..llm.routing import route
from ..logging import get_logger
from ..models import SystemFeedback, Task, TaskResult
from ..storage.artifacts import read_json, write_json, write_text
from ..storage.repos import feedback as fb_repo
from ..storage.repos import hypotheses as hyp_repo
from ..storage.repos import reviews as rev_repo
from ..storage.repos import sessions as sess_repo
from ..storage.repos import tournaments as tourney_repo
from .base import BaseAgent
from .schemas import RECORD_SYSTEM_FEEDBACK_TOOL

log = get_logger("metareview")

_REFERENCES_RE = re.compile(r"(?mi)^#{1,6}\s+references\b")


# ---------------------------- citation helpers ---------------------------- #
# The proposal must be backed by REAL citations only. These build a numbered
# reference list from the CitedPaper records that actually live on the top
# hypotheses' JSON artifacts (the hypotheses table drops citations).


async def hydrate_citations(cfg: Config, hyps) -> list[dict]:
    """Read CitedPaper records from each hypothesis artifact, dedupe, number.

    Returns ordered citation dicts (real data only — nothing invented). Dedupe
    is by URL, falling back to DOI. Order follows the hypotheses given, so the
    highest-Elo hypotheses' sources come first.
    """
    seen: set[str] = set()
    out: list[dict] = []
    for h in hyps:
        try:
            payload = await read_json(cfg, h.artifact_path)
        except Exception as e:  # missing/corrupt artifact — just skip it
            log.warning("citation_hydrate_failed", hypothesis_id=h.id, err=str(e))
            continue
        record = (payload or {}).get("record") or {}
        for c in record.get("citations", []):
            if not isinstance(c, dict):
                continue
            url = (c.get("url") or "").strip()
            doi = (c.get("doi") or "").strip()
            key = url or doi
            if not key or key in seen:
                continue
            seen.add(key)
            out.append({
                "n": len(out) + 1,
                "title": (c.get("title") or "Untitled").strip(),
                "url": url or None,
                "doi": doi or None,
                "year": c.get("year"),
                "excerpt": c.get("excerpt"),
            })
    return out


def _ref_loc(c: dict) -> str:
    if c.get("url"):
        return c["url"]
    if c.get("doi"):
        return f"https://doi.org/{c['doi']}"
    return ""


def _ref_line(c: dict, unverified: frozenset[str] = frozenset()) -> str:
    yr = c.get("year")
    mark = " (unverified)" if (c.get("url") in unverified or c.get("doi") in unverified) else ""
    return f"[{c['n']}] {c['title']} ({yr if yr else 'n.d.'}). {_ref_loc(c)}{mark}".rstrip()


def citations_prompt_block(cites: list[dict]) -> str:
    """The numbered list handed to the model — cite ONLY from these."""
    if not cites:
        return "(No citations were gathered for the top hypotheses. Do not invent any.)"
    return "\n".join(_ref_line(c) for c in cites)


def references_section(cites: list[dict], unverified: frozenset[str] = frozenset()) -> str:
    if not cites:
        return "## References\n\nNo verifiable citations were gathered."
    return "\n".join(["## References", "", *[_ref_line(c, unverified) for c in cites]])


def _strip_references(text: str) -> str:
    """Drop any (possibly model-invented) References section from `text`."""
    m = _REFERENCES_RE.search(text)
    return (text[:m.start()] if m else text).rstrip()


def ensure_references(
    text: str, cites: list[dict], unverified: frozenset[str] = frozenset()
) -> str:
    """Guarantee an authoritative References section built from real data.

    Belt-and-suspenders: whatever the model wrote for its own References section
    is replaced (or, if absent, appended) with one generated from `cites`, so the
    proposal can never carry an invented or incomplete reference list.
    """
    return f"{_strip_references(text)}\n\n{references_section(cites, unverified)}\n"


def _mm_id(s: str) -> str:
    return "n" + "".join(c for c in s if c.isalnum())


def _mm_label(s: str) -> str:
    return s.replace('"', " ").replace("\n", " ")[:30]


def _cell(s: str) -> str:
    """Escape GFM table-cell delimiters so a '|' in a title can't shift columns."""
    return s.replace("|", "\\|")


# ---------------------------- figure helpers ------------------------------ #
# Each returns a self-contained markdown figure body (table + ```chart, or a
# ```mermaid graph) or None when there's no data. `_weave_figures` numbers them
# in document order, adds captions, and splices each into its matching upper
# section of the LLM prose. Rendered on-site as SVG/Mermaid/KaTeX; copies as
# markdown (tables + fenced blocks) so a chart that fails to parse degrades to
# the table above it. Mirrors the shared subset of sim/content.ts figures.


def _fig_caption(n: int, text: str) -> str:
    """One-line italic figure caption (GEML academic style)."""
    return f"\n\n*Fig. {n} — {text}*"


def _scorecard_body(scored: list) -> str | None:
    if not scored:
        return None
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
    return (
        "| Proposal | Novelty | Correctness | Testability | Feasibility |\n"
        "|---|---|---|---|---|\n" + rows + "\n\n"
        "```chart\n" + json.dumps(spec) + "\n```"
    )


def _donut_body(top: list) -> str | None:
    strat_counts: dict = {}
    for h in top[:5]:
        strat_counts[h.strategy] = strat_counts.get(h.strategy, 0) + 1
    if not strat_counts:
        return None
    entries = sorted(strat_counts.items(), key=lambda kv: -kv[1])
    srows = "\n".join(f"| {k} | {v} |" for k, v in entries)
    dspec = {"type": "donut", "title": "Hypotheses by generation strategy",
             "segments": [{"label": k, "value": v} for k, v in entries]}
    return (
        "| Generation strategy | Hypotheses |\n|---|---|\n" + srows + "\n\n"
        "```chart\n" + json.dumps(dspec) + "\n```"
    )


def _elo_body(
    series: dict, labels: dict, title: str = "Elo over tournament matches"
) -> str | None:
    if not series:
        return None
    spec = {"type": "elo", "title": title, "series": series, "labels": labels}
    return "```chart\n" + json.dumps(spec) + "\n```"


def _assumptions_table(reviews: list, n: int) -> str | None:
    """Compact 'Key assumptions' markdown table (assumption / plausibility) built
    from the proposal's reviews — top 3 distinct rows. None when no structured
    assumptions exist. Unnumbered (no Fig.N), so section numbering is untouched."""
    rows: list[tuple[str, str]] = []
    seen: set[str] = set()
    for rv in reviews:
        for a in getattr(rv, "assumptions", None) or []:
            key = (a.assumption or "").strip()
            if not key or key in seen:
                continue
            seen.add(key)
            rows.append((key, a.plausibility))
            if len(rows) >= 3:
                break
        if len(rows) >= 3:
            break
    if not rows:
        return None
    body = "\n".join(f"| {_cell(a[:80])} | {pl} |" for a, pl in rows)
    return (
        f"**Key assumptions — proposal {n}**\n\n"
        "| Assumption | Plausibility |\n|---|---|\n" + body
    )


def _lineage_body(top: list) -> str | None:
    ids_shown = {h.id for h in top[:5]}
    nodes = "\n".join(f'  {_mm_id(h.id)}["{_mm_label(h.title)}"]' for h in top[:5])
    if not nodes:
        return None
    edges = "\n".join(
        f"  {_mm_id(p)} --> {_mm_id(h.id)}"
        for h in top[:5] for p in (h.parent_ids or []) if p in ids_shown
    )
    return "```mermaid\ngraph LR\n" + nodes + ("\n" + edges if edges else "") + "\n```"


_RATING_MODEL_NOTE = (
    "### Rating model\n\n"
    "Each match updates a hypothesis's Elo rating $R$ by\n\n"
    r"$$R'_a = R_a + K\,(S_a - E_a), \qquad "
    r"E_a = \frac{1}{1 + 10^{(R_b - R_a)/400}}$$"
    "\n\nwhere $S_a \\in \\{0, 1\\}$ is the match outcome for idea $a$ against "
    "idea $b$, and $K$ is the update rate (larger for newer ideas)."
)


def _insert_after_heading(text: str, keyword: str, block: str) -> tuple[str, bool]:
    """Splice `block` right after the first '## ' heading whose text contains
    `keyword` (case-insensitive). Returns (text, inserted?)."""
    kw = keyword.lower()
    for m in re.finditer(r"(?mi)^##\s+(.+?)\s*$", text):
        if kw in m.group(1).lower():
            i = m.end()
            return text[:i] + "\n\n" + block + text[i:], True
    return text, False


def _insert_after_proposal_heading(text: str, n: int, block: str) -> tuple[str, bool]:
    """Splice `block` at the END of the '### Proposal N' block — right before the
    next '##'/'###' heading or '---' rule (or EOF). Returns (text, inserted?).
    No-op on empty `block` or when no such proposal heading exists."""
    if not block:
        return text, False
    m = re.search(rf"(?mi)^###\s+Proposal\s+{n}\b.*$", text)
    if not m:
        return text, False
    tail = re.search(r"(?m)^(?:#{2,3}\s|-{3,}\s*$)", text[m.end():])
    end = m.end() + tail.start() if tail else len(text)
    return text[:end].rstrip() + "\n\n" + block + "\n\n" + text[end:].lstrip("\n"), True


def _match_proposal_hyp(text: str, n: int, top: list):
    """Match the '### Proposal n' block to its hypothesis by the `[H-...]` id
    marker the metareview_final prompt embeds in each block; fall back to the
    ordinal tournament order when no id is found."""
    m = re.search(rf"(?mi)^###\s+Proposal\s+{n}\b.*$", text)
    if m:
        tail = re.search(r"(?m)^(?:#{2,3}\s|-{3,}\s*$)", text[m.end():])
        block = text[m.end(): m.end() + tail.start()] if tail else text[m.end():]
        for h in top:
            if h.id in block:
                return h
    return top[n - 1] if 0 <= n - 1 < len(top) else None


def _weave_figures(
    top: list, reviews_by_hyp: dict, elo_series: dict, elo_labels: dict, text: str
) -> str:
    """Splice content figures into their matching upper sections of the LLM prose;
    the rating-model note plus any figure whose section is absent land in a slim
    trailing '## Analysis'. Deterministic (real data), so the figures are correct
    regardless of the prose. Caller strips model References first; the
    authoritative list is appended afterwards so it stays last."""
    scored = []
    for h in top[:5]:
        sc = next((r.scores for r in reviews_by_hyp.get(h.id, []) if r.scores), None)
        if sc is not None:
            scored.append((h, sc))

    # (heading keyword, [(body, caption), ...]) in document order.
    sections = [
        ("approach landscape", [
            (_donut_body(top),
             "share of the finalist hypotheses by generation strategy."),
        ]),
        ("ranked proposal", [
            (_scorecard_body(scored),
             "reviewer scores across the four dimensions for each finalist."),
        ]),
        ("comparative assessment", [
            (_elo_body(elo_series, elo_labels),
             "Elo trajectory of the finalists across tournament matches."),
            (_lineage_body(top),
             "idea lineage — offspring the Evolution agent bred from top parents."),
        ]),
    ]

    n = 0
    leftovers: list[str] = []
    for keyword, items in sections:
        blocks: list[str] = []
        for body, caption in items:
            if not body:
                continue
            n += 1
            blocks.append(body + _fig_caption(n, caption))
        if not blocks:
            continue
        combined = "\n\n".join(blocks)
        text, ok = _insert_after_heading(text, keyword, combined)
        if not ok:
            leftovers.append(combined)

    # Per-proposal figures (UNNUMBERED, so section Fig.N numbering is untouched):
    # an Elo sparkline + a compact "Key assumptions" table spliced at the END of
    # each of the top-3 `### Proposal N` blocks. Match each block to its
    # hypothesis by the `[H-...]` id marker; fall back to ordinal order.
    for i in range(min(3, len(top))):
        n = i + 1
        h = _match_proposal_hyp(text, n, top[:5]) or top[i]
        per: list[str] = []
        series = elo_series.get(h.id)
        if series and len(series) > 1:
            fig = _elo_body({h.id: series}, {h.id: h.title[:24]},
                            f"Elo trajectory — proposal {n}")
            if fig:
                per.append(fig)
        table = _assumptions_table(reviews_by_hyp.get(h.id, []), n)
        if table:
            per.append(table)
        if per:
            text, _ = _insert_after_proposal_heading(text, n, "\n\n".join(per))

    analysis = "\n\n".join(["## Analysis", *leftovers, _RATING_MODEL_NOTE])
    return text.rstrip() + "\n\n" + analysis


class MetaReviewAgent(BaseAgent):
    name = "metareview"

    async def execute(self, task: Task) -> TaskResult:
        if task.action == "GenerateSystemFeedback":
            return await self._system_feedback(task)
        if task.action == "GenerateSelfCritique":
            return await self._self_critique(task)
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

    # ----------------------------- self-critique ----------------------------- #

    async def _self_critique(self, task: Task) -> TaskResult:
        """Recurring adversarial self-questioning of the current leaderboard.

        Routes to Opus with extended thinking (tool_choice=auto keeps thinking
        enabled) and posts a `self_critique` SystemFeedback row whose text
        includes the visible thinking process for the chat feed.
        """
        session = await sess_repo.fetch(self.deps.db, task.session_id)
        if session is None:
            raise RuntimeError(f"session {task.session_id} missing")

        reviews = await rev_repo.list_for_session(self.deps.db, session.id)
        if not reviews:
            return TaskResult(kind="noop", extra={"reason": "no reviews yet"})
        top = await hyp_repo.top_by_elo(self.deps.db, session.id, k=5)
        if not top:
            return TaskResult(kind="noop", extra={"reason": "no ranked hypotheses yet"})

        reviews_by_hyp: dict[str, list] = {}
        for rv in reviews:
            reviews_by_hyp.setdefault(rv.hypothesis_id, []).append(rv)

        chunks: list[str] = []
        for h in top:
            review_lines = [
                f"  - {r.kind}: verdict={r.verdict or '?'} "
                f"(n={r.scores.novelty}, c={r.scores.correctness}, t={r.scores.testability})"
                for r in reviews_by_hyp.get(h.id, [])
            ]
            elo_s = f"{h.elo:.0f}" if h.elo is not None else "—"
            chunks.append(
                f"### `{h.id}` (Elo {elo_s}, strategy `{h.strategy}`)\n"
                f"**Title.** {h.title}\n\n"
                f"{h.summary}\n\n"
                f"**Reviews:**\n" + ("\n".join(review_lines) or "  (none)")
            )
        top_block = "\n\n---\n\n".join(chunks)

        reviews_block = "\n\n---\n\n".join(
            f"### Review of `{r.hypothesis_id}` (kind={r.kind}, verdict={r.verdict or '?'})\n{r.body[:3000]}"
            for r in reviews[:30]
        )
        rationales = await tourney_repo.recent_rationales(self.deps.db, session.id, limit=30)
        debate_block = "\n\n---\n\n".join(rat[:1500] for rat in rationales if rat)
        previous = await fb_repo.latest_system_feedback(
            self.deps.db, session.id, kind="self_critique"
        )
        round_n = task.payload.get("round", 0)

        prompt = render(
            "metareview.critique",
            round=round_n,
            goal=session.research_plan.objective,
            preferences="; ".join(session.research_plan.preferences),
            top_hypotheses_block=top_block,
            reviews=reviews_block,
            debate_rationales=debate_block,
            previous_critique=(previous.text[:4000] if previous else ""),
        )
        r = route(self.deps.cfg, "metareview", "critique")
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
            # "auto" (not a forced tool) so extended thinking stays enabled.
            tool_choice={"type": "auto"},
            max_output_tokens=16384,   # must exceed the thinking budget
        )
        ctx = CallContext(
            session_id=session.id, task_id=task.id,
            agent="metareview", action="GenerateSelfCritique", mode="critique",
        )
        resp = await self.deps.llm.call(spec, ctx)

        thinking = self._thinking_text(resp)
        record = self._final_tool_use(resp, "record_system_feedback")
        narrative = ((record or {}).get("narrative") or "").strip() or self._final_text(resp)
        if not narrative.strip():
            return TaskResult(kind="noop", extra={"reason": "empty critique"})

        text = ""
        if thinking:
            text += f"## Thinking\n\n{thinking[:4000]}\n\n"
        text += f"## Self-critique\n\n{narrative}"

        fb_id = ids.feedback_id()
        artifact_path = await write_json(
            self.deps.cfg, session.id, "self_critique", fb_id,
            {"round": round_n, "thinking": thinking, "narrative": narrative,
             "record": record},
        )
        await fb_repo.insert(self.deps.db, SystemFeedback(
            id=fb_id, session_id=session.id, created_at=datetime.now(UTC),
            source="meta_review", kind="self_critique",
            target_id=None, text=text[:8000],
            artifact_path=artifact_path, active=True,
        ))
        return TaskResult(
            kind="self_critique_generated",
            extra={"feedback_id": fb_id, "round": round_n},
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

        # Real citations only — built from the top hypotheses' CitedPaper records.
        cites = await hydrate_citations(self.deps.cfg, top)

        stress_block = await self._stress_block(session.id)

        prompt = render(
            "metareview.final",
            goal=session.research_plan.objective,
            preferences="; ".join(session.research_plan.preferences),
            system_feedback=latest_fb.text if latest_fb else "",
            top_hypotheses_block=top_block,
            citations_block=citations_prompt_block(cites),
            stress_test_block=stress_block,
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

        # Splice deterministic figures (built from real data) into the LLM's
        # upper sections — donut in the approach landscape, scorecard in ranked
        # proposals, Elo race + lineage in the comparative assessment — with a
        # slim rating-model note trailing. Strip any model-written References
        # first so the authoritative list stays last.
        elo_series = await tourney_repo.elo_series(
            self.deps.db, session.id, [h.id for h in top[:5]]
        )
        elo_labels = {h.id: h.title[:24] for h in top[:5]}
        text = _weave_figures(
            top, reviews_by_hyp, elo_series, elo_labels,
            _strip_references(text).rstrip(),
        )

        # Guarantee a numbered References section built from real citation data,
        # flagging any source the citation verifier could not confirm. Skip the
        # (network) verifier pass entirely when there are no citations to mark.
        unverified = await self._unverified_urls(session, top, reviews_by_hyp) if cites else frozenset()
        text = text.rstrip() + "\n\n" + references_section(cites, unverified) + "\n"

        overview_path = await write_text(
            self.deps.cfg, session.id, "final", "overview", ".md", text
        )
        return TaskResult(
            kind="final_overview_generated",
            extra={"overview_path": overview_path, "n_top": len(top)},
        )

    async def _stress_block(self, session_id: str) -> str:
        """Stress-test reports + the post-fix ranking, for the final proposal.

        Returns '' when the stress stage did not run so the template omits the
        section. Reads the meta_review feedback rows the stress stage wrote.
        """
        async with self.deps.db.execute(
            """SELECT kind, target_id, text FROM system_feedback
                  WHERE session_id=? AND source='meta_review'
                    AND kind IN ('stress_test','stress_ranking')
                  ORDER BY created_at""",
            (session_id,),
        ) as cur:
            rows = await cur.fetchall()
        if not rows:
            return ""
        parts: list[str] = []
        for r in rows:
            if r["kind"] == "stress_ranking":
                parts.append(r["text"])
            else:
                tgt = f" (`{r['target_id']}`)" if r["target_id"] else ""
                parts.append(f"### Stress test{tgt}\n{r['text']}")
        return "\n\n---\n\n".join(parts)

    async def _unverified_urls(self, session, top, reviews_by_hyp) -> frozenset[str]:
        """URLs the citation verifier could not confirm (status != 'ok').

        The verifier persists nothing, so there are no stored flags to read; we
        recompute over the top hypotheses' reviews. Fetches are disk-cached (the
        pages were already fetched during reflection), and the whole thing is
        gated by `[safety] enable_citation_verifier` and best-effort — a verifier
        failure never blocks the overview.
        # ponytail: O(reviews×evidence) cached fetches on the final path; if this
        # ever dominates latency, persist verifier output at reflection time.
        """
        if not self.deps.cfg.safety.enable_citation_verifier:
            return frozenset()
        from ..safety.citation_verifier import CitationVerifier

        verifier = CitationVerifier(self.deps.cfg)
        bad: set[str] = set()
        for h in top:
            for rv in reviews_by_hyp.get(h.id, []):
                try:
                    status = await verifier.verify_review(session.id, rv, self.deps.db)
                except Exception as e:
                    log.warning("citation_verify_failed", review_id=rv.id, err=str(e))
                    continue
                bad.update(url for url, info in status.items() if info.get("status") != "ok")
        return frozenset(bad)
