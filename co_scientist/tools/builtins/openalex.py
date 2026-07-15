"""OpenAlex scholarly-database search.

OpenAlex indexes 200M+ works across every field with resolving DOIs. No API key
required; supplying a `mailto` puts us in the faster "polite pool". Returns light
records (title, url, doi, year, authors, venue, abstract, abs_url).
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from ...config import Config
from ..base import ToolCtx, ToolResult

OPENALEX_URL = "https://api.openalex.org/works"
# Polite-pool contact (no key needed); a bare constant is enough here.
OPENALEX_MAILTO = "co-scientist@users.noreply.github.com"
_ABSTRACT_MAX = 1500


class OpenAlexSearchTool:
    name = "openalex_search"
    description = (
        "Search the OpenAlex scholarly database (200M+ works across all fields) for real "
        "papers with resolving DOIs; use to ground hypotheses in existing literature. Returns "
        "{title, url, doi, year, authors, venue, abstract, abs_url}."
    )
    input_schema: dict[str, Any] = {
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "per_page": {"type": "integer", "minimum": 1, "maximum": 10, "default": 5},
            "from_year": {
                "type": "integer",
                "description": "Only return works published in or after this year.",
            },
        },
        "required": ["query"],
    }

    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg

    async def call(self, args: dict[str, Any], ctx: ToolCtx) -> ToolResult:
        t0 = time.monotonic()
        query = args.get("query", "").strip()
        n = min(int(args.get("per_page") or 5), 10)
        from_year = args.get("from_year")
        if not query:
            return ToolResult(is_error=True, error_message="empty query")

        params: dict[str, Any] = {"search": query, "per-page": n, "mailto": OPENALEX_MAILTO}
        if from_year:
            params["filter"] = f"from_publication_date:{int(from_year)}-01-01"

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.get(
                    OPENALEX_URL,
                    params=params,
                    headers={"User-Agent": f"co-scientist ({OPENALEX_MAILTO})"},
                )
                r.raise_for_status()
                data = r.json()
        except httpx.HTTPError as e:
            return ToolResult(is_error=True, error_message=f"openalex failed: {e}")

        results = _parse_openalex(data)[:n]
        payload = {"query": query, "n": len(results), "results": results}
        return ToolResult(
            content=payload,
            duration_ms=int((time.monotonic() - t0) * 1000),
            result_bytes=len(str(payload)),
        )


def _reconstruct_abstract(inverted: dict[str, list[int]] | None) -> str:
    """Rebuild plain text from OpenAlex's word->positions inverted index."""
    if not inverted:
        return ""
    positioned: list[tuple[int, str]] = [
        (pos, word) for word, positions in inverted.items() for pos in positions
    ]
    positioned.sort()
    text = " ".join(word for _, word in positioned)
    return text[:_ABSTRACT_MAX]


def _parse_openalex(data: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for w in data.get("results", []):
        doi_url = w.get("doi")  # e.g. "https://doi.org/10.1234/foo" or None
        landing = w.get("id")   # e.g. "https://openalex.org/W123"
        if not doi_url and not landing:
            continue
        doi = doi_url.replace("https://doi.org/", "") if doi_url else None
        authors = [
            a["author"]["display_name"]
            for a in w.get("authorships", [])[:6]
            if a.get("author", {}).get("display_name")
        ]
        source = (w.get("primary_location") or {}).get("source") or {}
        out.append(
            {
                "title": w.get("title"),
                "url": doi_url or landing,
                "doi": doi,
                "year": w.get("publication_year"),
                "authors": authors,
                "venue": source.get("display_name"),
                "abstract": _reconstruct_abstract(w.get("abstract_inverted_index")),
                "abs_url": landing,
            }
        )
    return out
