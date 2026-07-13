"""JSON REST API consumed by the React dashboard."""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from .. import ids
from ..agents.supervisor import Supervisor
from ..config import Config, has_llm_key
from ..logging import get_logger
from ..models import SystemFeedback
from ..orchestrator.events import GLOBAL_BUS
from ..storage import db as db_mod
from ..storage.repos import events as events_repo
from ..storage.repos import feedback as fb_repo
from ..storage.repos import hypotheses as hyp_repo
from ..storage.repos import sessions as sess_repo
from .user_keys import apply_user_credentials, require_llm_credentials

log = get_logger("react_api")

PROVIDERS = [
    {"id": "anthropic", "label": "Anthropic", "models": ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"]},
    {"id": "openai", "label": "OpenAI", "models": ["gpt-5", "gpt-4o", "o3-mini"]},
    {"id": "openrouter", "label": "OpenRouter", "models": ["openai/gpt-5", "google/gemini-2.5-pro", "anthropic/claude-3.5-sonnet"]},
    {"id": "gemini", "label": "Google Gemini", "models": ["gemini-2.5-pro", "gemini-2.5-flash"]},
    {"id": "groq", "label": "Groq", "models": ["llama-3.3-70b-versatile"]},
    {"id": "ollama", "label": "Ollama (local)", "models": ["llama3.3:70b", "qwen2.5:32b"]},
]

README_LOCAL_URL = "https://github.com/duckyquang/Co-Scientist#option-1-run-locally"


def _sync_store():
    from webapp import store

    return store


def _db_conn(cfg: Config):
    return _sync_store().connect(cfg.db_path)


async def _run_sync(fn, *args, **kwargs):
    return await asyncio.to_thread(fn, *args, **kwargs)


class CreateSessionBody(BaseModel):
    goal: str
    # Run limits — the session stops at whichever is hit first. Both are already
    # enforced end-to-end (termination.budget_exhausted / wall_clock_exceeded).
    budget_tokens: int = Field(default=5_000_000, ge=100_000)
    wall_clock_seconds: int = Field(default=1800, ge=60)
    budget_usd: float | None = None  # optional legacy cap; None → keep config default
    n_initial: int = Field(default=4, ge=2, le=50)
    provider: str | None = None
    speed: float = 1.0  # accepted for API compat; real engine ignores demo pace


class FeedbackBody(BaseModel):
    text: str
    kind: str = "directive"
    target_id: str | None = None


class HypStateBody(BaseModel):
    state: str


def create_react_router(base_cfg: Config, *, live_sessions: set[str]) -> APIRouter:
    router = APIRouter(prefix="/api")

    def _cfg(request: Request) -> Config:
        return apply_user_credentials(base_cfg, request)

    @router.get("/meta")
    async def meta(request: Request) -> JSONResponse:
        cfg = _cfg(request)
        server_has_key = has_llm_key(base_cfg)
        user_has_key = has_llm_key(cfg)
        return JSONResponse({
            "demo_mode": not user_has_key,
            "static_demo": False,
            "hosted": True,
            "server_has_key": server_has_key,
            "requires_api_key": not user_has_key,
            "readme_local_url": README_LOCAL_URL,
            "providers": PROVIDERS,
            "models": base_cfg.models.model_dump(),
            "defaults": {
                "budget_usd": base_cfg.run.budget_usd,
                "budget_tokens": base_cfg.run.budget_tokens,
                "n_initial": 4,
                "wall_clock_seconds": base_cfg.run.wall_clock_seconds,
            },
        })

    @router.get("/stats")
    async def stats() -> JSONResponse:
        conn = await _run_sync(_db_conn, base_cfg)
        try:
            return JSONResponse(await _run_sync(_sync_store().global_stats, conn))
        finally:
            conn.close()

    @router.get("/sessions")
    async def list_sessions() -> JSONResponse:
        conn = await _run_sync(_db_conn, base_cfg)
        try:
            return JSONResponse({"sessions": await _run_sync(_sync_store().list_sessions, conn)})
        finally:
            conn.close()

    @router.get("/sessions/{session_id}")
    async def session_detail(session_id: str) -> JSONResponse:
        store = _sync_store()
        conn = await _run_sync(_db_conn, base_cfg)
        try:
            s = await _run_sync(store.get_session, conn, session_id)
            if not s:
                raise HTTPException(404, "session not found")
            return JSONResponse({
                "session": s,
                "metrics": await _run_sync(store.metrics, conn, session_id),
                "counts": await _run_sync(store.session_counts, conn, session_id),
                "live": session_id in live_sessions,
            })
        finally:
            conn.close()

    @router.get("/sessions/{session_id}/hypotheses")
    async def hypotheses(session_id: str) -> JSONResponse:
        conn = await _run_sync(_db_conn, base_cfg)
        try:
            hyps = await _run_sync(_sync_store().list_hypotheses, conn, session_id)
            return JSONResponse({"hypotheses": hyps})
        finally:
            conn.close()

    @router.get("/sessions/{session_id}/hypotheses/{hid}")
    async def hypothesis(session_id: str, hid: str) -> JSONResponse:
        conn = await _run_sync(_db_conn, base_cfg)
        try:
            h = await _run_sync(_sync_store().get_hypothesis, conn, hid)
            if not h or h.get("session_id") != session_id:
                raise HTTPException(404, "hypothesis not found")
            return JSONResponse(h)
        finally:
            conn.close()

    @router.get("/sessions/{session_id}/matches")
    async def matches(session_id: str) -> JSONResponse:
        conn = await _run_sync(_db_conn, base_cfg)
        try:
            return JSONResponse({"matches": await _run_sync(_sync_store().list_matches, conn, session_id)})
        finally:
            conn.close()

    @router.get("/sessions/{session_id}/cost")
    async def cost(session_id: str) -> JSONResponse:
        store = _sync_store()
        conn = await _run_sync(_db_conn, base_cfg)
        try:
            return JSONResponse({
                "by_agent": await _run_sync(store.cost_by_agent, conn, session_id),
                "summary": await _run_sync(store.usage_summary, conn, session_id),
            })
        finally:
            conn.close()

    @router.get("/sessions/{session_id}/feedback")
    async def feedback_list(session_id: str) -> JSONResponse:
        conn = await _run_sync(_db_conn, base_cfg)
        try:
            return JSONResponse({"feedback": await _run_sync(_sync_store().list_feedback, conn, session_id)})
        finally:
            conn.close()

    @router.get("/sessions/{session_id}/lineage")
    async def lineage(session_id: str) -> JSONResponse:
        conn = await _run_sync(_db_conn, base_cfg)
        try:
            return JSONResponse(await _run_sync(_sync_store().lineage, conn, session_id))
        finally:
            conn.close()

    @router.get("/sessions/{session_id}/clusters")
    async def clusters(session_id: str) -> JSONResponse:
        conn = await _run_sync(_db_conn, base_cfg)
        try:
            pts = await _run_sync(_sync_store().clusters, conn, session_id)
            return JSONResponse({"points": pts})
        finally:
            conn.close()

    @router.get("/sessions/{session_id}/elo-history")
    async def elo_history(session_id: str) -> JSONResponse:
        conn = await _run_sync(_db_conn, base_cfg)
        try:
            series = await _run_sync(_sync_store().elo_history_all, conn, session_id)
            return JSONResponse({"series": series})
        finally:
            conn.close()

    @router.get("/sessions/{session_id}/overview")
    async def overview(session_id: str) -> JSONResponse:
        store = _sync_store()
        conn = await _run_sync(_db_conn, base_cfg)
        try:
            s = await _run_sync(store.get_session, conn, session_id)
            if not s or not s.get("final_overview"):
                raise HTTPException(404, "no overview yet")
            base = base_cfg.data_dir.resolve()
            try:
                p = (base_cfg.data_dir / s["final_overview"]).resolve()
                p.relative_to(base)
            except (ValueError, OSError) as e:
                raise HTTPException(404, "overview unavailable") from e
            if not p.is_file():
                raise HTTPException(404, "overview missing")
            return JSONResponse({"markdown": p.read_text(encoding="utf-8")})
        finally:
            conn.close()

    @router.get("/sessions/{session_id}/stream")
    async def stream(session_id: str) -> EventSourceResponse:
        async def _gen() -> AsyncIterator[dict[str, Any]]:
            conn = await db_mod.connect(base_cfg)
            try:
                history = await events_repo.recent(conn, session_id, limit=25)
            finally:
                await conn.close()
            for ev in reversed(history):
                yield {
                    "event": ev["event"],
                    "data": json.dumps({
                        "id": ev.get("id"),
                        "ts": ev["ts"],
                        "agent": ev.get("agent"),
                        "payload": ev["payload"],
                    }, default=str),
                }
            async with contextlib.aclosing(GLOBAL_BUS.subscribe(session_id)) as gen:
                async for ev in gen:
                    yield {"event": ev.name, "data": ev.to_json()}

        return EventSourceResponse(_gen())

    @router.post("/sessions")
    async def create_session(request: Request, body: CreateSessionBody) -> JSONResponse:
        cfg = _cfg(request)
        require_llm_credentials(cfg)
        goal = body.goal.strip()
        if len(goal) < 12:
            raise HTTPException(400, "goal is required (at least a sentence)")

        if body.provider:
            cfg.llm.provider = body.provider
        cfg.run.budget_tokens = body.budget_tokens
        cfg.run.wall_clock_seconds = body.wall_clock_seconds
        if body.budget_usd is not None:
            cfg.run.budget_usd = body.budget_usd
        sup = Supervisor(cfg)

        async def _bg() -> None:
            live_sessions.add("_pending")
            try:
                sid = await sup.run_session(
                    goal, n_initial=body.n_initial,
                    wall_clock_seconds=body.wall_clock_seconds,
                )
                live_sessions.add(sid)
            except Exception:
                log.exception("session_run_failed", goal=goal[:80])
            finally:
                live_sessions.discard("_pending")

        asyncio.create_task(_bg())

        # Session row is created within the first seconds of run_session.
        deadline = time.time() + 45.0
        while time.time() < deadline:
            conn = await _run_sync(_db_conn, cfg)
            try:
                rows = await _run_sync(_sync_store().list_sessions, conn)
            finally:
                conn.close()
            for row in rows:
                if row["research_goal"] == goal and row["status"] in ("running", "paused"):
                    live_sessions.add(row["id"])
                    return JSONResponse({"session_id": row["id"], "ok": True}, status_code=201)
            await asyncio.sleep(0.3)

        raise HTTPException(504, "session is starting — refresh the dashboard in a moment")

    async def _control(session_id: str, action: str) -> JSONResponse:
        status = {"pause": "paused", "resume": "running", "abort": "aborted"}[action]
        conn = await db_mod.connect(base_cfg)
        try:
            await sess_repo.set_status(conn, session_id, status)
            await GLOBAL_BUS.publish(session_id, f"session_{status}", {})
            return JSONResponse({"ok": True, "status": status})
        finally:
            await conn.close()

    @router.post("/sessions/{session_id}/pause")
    async def pause(session_id: str) -> JSONResponse:
        return await _control(session_id, "pause")

    @router.post("/sessions/{session_id}/resume")
    async def resume(session_id: str) -> JSONResponse:
        return await _control(session_id, "resume")

    @router.post("/sessions/{session_id}/abort")
    async def abort(session_id: str) -> JSONResponse:
        return await _control(session_id, "abort")

    @router.post("/sessions/{session_id}/feedback")
    async def post_feedback(session_id: str, body: FeedbackBody) -> JSONResponse:
        text = body.text.strip()
        if not text:
            raise HTTPException(400, "text required")
        conn = await db_mod.connect(base_cfg)
        try:
            fb = SystemFeedback(
                id=ids.feedback_id(), session_id=session_id,
                created_at=datetime.now(UTC),
                source="human", kind=body.kind,
                target_id=body.target_id, text=text, active=True,
            )
            await fb_repo.insert(conn, fb)
            if body.kind == "pin" and body.target_id:
                await hyp_repo.set_state(conn, body.target_id, "pinned")
            elif body.kind == "rejection" and body.target_id:
                await hyp_repo.set_state(conn, body.target_id, "rejected")
            await GLOBAL_BUS.publish(session_id, "human_feedback", {
                "kind": body.kind, "target_id": body.target_id, "text": text[:200],
            })
            return JSONResponse({"ok": True, "feedback_id": fb.id})
        finally:
            await conn.close()

    @router.post("/sessions/{session_id}/hypotheses/{hid}/state")
    async def hyp_state(session_id: str, hid: str, body: HypStateBody) -> JSONResponse:
        if body.state not in ("pinned", "rejected", "in_tournament", "retired"):
            raise HTTPException(400, "bad state")
        conn = await db_mod.connect(base_cfg)
        try:
            await hyp_repo.set_state(conn, hid, body.state)
            await GLOBAL_BUS.publish(session_id, "hypothesis_state_changed", {
                "hypothesis_id": hid, "state": body.state,
            })
            return JSONResponse({"ok": True})
        finally:
            await conn.close()

    return router
