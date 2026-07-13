"""Chat follow-up handler (runtime C).

One-shot request handler — NOT a queue agent. A single LLM call classifies the
scientist's message (question / tweak / out_of_scope), answers questions grounded
in the session's data, and expands tweak requests into a self-contained change.

The rerun-goal template + out-of-scope string are composed by the caller
(react_api) using the canonical helpers in `webapp.content`, so all three
runtimes stay byte-identical.
"""

from __future__ import annotations

from typing import Any

import aiosqlite

from ..config import Config
from ..llm.anthropic_client import AgentCallSpec, CachedBlock, CallContext
from ..llm.budgets import TokenBudget
from ..llm.prompts import render
from ..llm.provider import get_provider
from ..llm.routing import route
from ..logging import get_logger
from ..safety.quoting import SAFETY_PREAMBLE, quote_untrusted
from ..storage.repos import hypotheses as hyp_repo
from ..storage.repos import sessions as sess_repo
from .base import BaseAgent
from .schemas import RESPOND_TO_CHAT_TOOL

log = get_logger("chat")


def _format_top(hyps: list) -> str:
    """One line per hypothesis: id | Elo | state | title | summary."""
    if not hyps:
        return "(no hypotheses yet)"
    lines = []
    for h in hyps:
        elo = round(h.elo) if h.elo is not None else "—"
        summary = (h.summary or "").replace("\n", " ").strip()
        lines.append(f"- {h.id} | Elo {elo} | {h.state} | {h.title} | {summary}")
    return "\n".join(lines)


def _read_overview(cfg: Config, session) -> str:
    """Safe-path read of the session's final overview markdown; '' if none."""
    rel = getattr(session, "final_overview", None)
    if not rel:
        return ""
    base = cfg.data_dir.resolve()
    try:
        p = (cfg.data_dir / rel).resolve()
        p.relative_to(base)
    except (ValueError, OSError):
        return ""
    if not p.is_file():
        return ""
    try:
        return p.read_text(encoding="utf-8")
    except OSError:
        return ""


async def handle_chat(
    cfg: Config,
    conn: aiosqlite.Connection,
    budget: TokenBudget,
    session_id: str,
    message: str,
) -> dict[str, Any]:
    """Classify + answer/expand in one LLM call. No DB side effects.

    Returns {intent, reply_markdown, change_request, idea}.
    """
    session = await sess_repo.fetch(conn, session_id)
    if session is None:
        raise ValueError(f"session {session_id} not found")

    top = await hyp_repo.top_by_elo(conn, session_id, k=10)
    overview = _read_overview(cfg, session)
    prompt = render(
        "chat_router",
        goal=session.research_goal,
        overview=overview[:4000],
        top_hypotheses_block=_format_top(top),
        message=quote_untrusted(message, id_="chat_message"),
    )

    llm = get_provider(cfg, db=conn, budget=budget)
    r = route(cfg, "chat", None)
    spec = AgentCallSpec(
        route=r,
        system_blocks=[CachedBlock(
            "You are the Co-Scientist follow-up assistant. " + SAFETY_PREAMBLE,
            cache=True,
        )],
        user_blocks=[CachedBlock(prompt, cache=False)],
        tools=[RESPOND_TO_CHAT_TOOL],
        tool_choice={"type": "tool", "name": "respond_to_chat"},
        max_output_tokens=1500,
    )
    ctx = CallContext(session_id=session_id, task_id=None, agent="chat", action="chat")
    resp = await llm.call(spec, ctx)
    rec = BaseAgent._final_tool_use(resp, "respond_to_chat") or {
        "intent": "question", "reply_markdown": ""
    }

    # `{idea}` = top hypothesis "{title} — {summary}", else the research goal.
    if top:
        idea = f"{top[0].title} — {top[0].summary}" if top[0].summary else top[0].title
    else:
        idea = session.research_goal

    return {
        "intent": rec.get("intent", "question"),
        "reply_markdown": rec.get("reply_markdown", ""),
        "change_request": rec.get("change_request") or message,
        "idea": idea,
    }
