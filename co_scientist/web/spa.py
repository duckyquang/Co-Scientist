"""Serve the built React SPA from frontend/dist."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..config import PROJECT_ROOT

DIST = PROJECT_ROOT / "frontend" / "dist"


def create_spa_router() -> APIRouter:
    router = APIRouter(include_in_schema=False)

    @router.get("/{full_path:path}")
    async def spa_fallback(full_path: str) -> FileResponse:
        if not DIST.exists():
            raise HTTPException(
                503,
                detail="Frontend not built. Run: cd frontend && npm install && npm run build",
            )
        # Serve static asset if it exists.
        if full_path and not full_path.startswith("api"):
            candidate = (DIST / full_path).resolve()
            try:
                candidate.relative_to(DIST.resolve())
                if candidate.is_file():
                    return FileResponse(candidate)
            except ValueError:
                pass
        index = DIST / "index.html"
        if not index.is_file():
            raise HTTPException(503, detail="frontend/dist/index.html missing")
        return FileResponse(index)

    return router
