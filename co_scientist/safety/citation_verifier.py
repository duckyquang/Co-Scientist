"""Citation verifier — makes hypothesis citations authoritative at the source.

The Generation / Evolution agents attach a `CitedPaper{title, url, excerpt, doi}`
to each hypothesis. The url is already constrained to URLs that actually appeared
in tool results (see `tool_loop.seen_urls` + `_filter_to_seen_urls`), so it can't
be invented. This verifier closes the remaining hallucination gaps:

1. Fetch the url (disk-cached by web_fetch; bounded by a per-hypothesis fetch
   budget + the tool timeout).
2. Check the `excerpt` actually appears on the fetched page (normalized
   substring). A readable page that does NOT contain the claimed quote is a
   fabricated excerpt → the citation is DROPPED.
3. Corroborate the `doi` against the url / fetched page; a doi that neither the
   url nor the page backs up is blanked (the real url is kept).

The result is persisted per-citation as `CitedPaper.verified` (True | False |
None) inside the hypothesis record JSON, so downstream (meta-review references)
reads a STORED flag instead of re-fetching.

Policy is conservative — only *positive* evidence of fabrication drops a
citation. Fetch failures (network / paywall / HTTP error / thin extraction) and
an exhausted budget leave `verified = None` and keep the citation, flagged
`(unverified)` downstream, so real-but-unreachable papers are never nuked.

The fuzzy-match step uses simple normalized substring search; we deliberately do
NOT make a second LLM call.
"""

from __future__ import annotations

import asyncio
import re

from ..config import Config
from ..logging import get_logger
from ..tools.base import ToolCtx
from ..tools.web_fetch import WebFetchTool

log = get_logger("safety.citation_verifier")

_WS_RE = re.compile(r"\s+")
# Leading/trailing ellipsis, quotes and whitespace the model wraps quotes in
# ("...reduced markers by 60%...") — strip them before substring matching.
_EDGE_RE = re.compile(r"^[\s\"'.…]+|[\s\"'.…]+$")

# Below this many extracted characters we treat a fetch as too thin to trust an
# excerpt *absence* (paywall stub / extraction gap) → flag, never drop.
# ponytail: fixed threshold; make it config if real papers still get nuked.
_MIN_TEXT_FOR_ABSENCE = 500


def _normalize(s: str) -> str:
    return _WS_RE.sub(" ", s.lower()).strip()


def _core_excerpt(s: str) -> str:
    return _EDGE_RE.sub("", s)


def _doi_corroborated(url: str, doi: str, text: str) -> bool:
    """A doi is trustworthy only if the real url or the fetched page backs it up."""
    d = doi.lower().strip()
    if not d:
        return False
    if d in url.lower():             # doi.org/<doi> link or url embeds the doi
        return True
    return d in _normalize(text)     # page references the doi


class CitationVerifier:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._fetcher = WebFetchTool(cfg)

    async def verify_citations(
        self, session_id: str, citations: list[dict], *, run_id: str | None = None
    ) -> list[dict]:
        """Verify record citations at the source (Generation / Evolution).

        Each citation dict (already filtered to seen URLs by the caller) is
        annotated in place with `verified` and, when the doi can't be
        corroborated, has its `doi` blanked. Citations whose excerpt is
        contradicted by a readable page are DROPPED; everything else is kept.

        Returns the surviving list. No-op (leaves `verified` unset → None,
        drops nothing, touches no doi) when the verifier is disabled.
        """
        if not self._cfg.safety.enable_citation_verifier:
            return citations

        ctx = ToolCtx(cfg=self._cfg, session_id=session_id, task_id=None, run_id=run_id)
        budget = self._cfg.safety.citation_verify_max_fetches
        timeout = float(self._cfg.tool_loop.tool_timeout_seconds)

        kept: list[dict] = []
        fetches = 0
        for c in citations:
            if not isinstance(c, dict) or not (c.get("url") or "").strip():
                continue
            url = c["url"].strip()
            excerpt = c.get("excerpt")
            doi = (c.get("doi") or "").strip()

            if fetches >= budget:
                c["verified"] = None          # budget spent — keep + flag
                kept.append(c)
                continue
            fetches += 1

            text = await self._fetch_text(ctx, url, timeout)
            if text is None:
                # Soft fail: url was really seen but we couldn't re-read it
                # (network / paywall / HTTP error / thin page). Never drop.
                c["verified"] = None
                kept.append(c)
                continue

            # DOI corroboration is independent of the excerpt outcome.
            if doi and not _doi_corroborated(url, doi, text):
                c["doi"] = None

            if excerpt:
                found = _normalize(_core_excerpt(excerpt)[:200]) in _normalize(text)
                c["verified"] = found
                if not found:
                    log.info("citation_dropped_bad_excerpt", url=url)
                    continue                  # DROP: readable page, quote absent
            else:
                c["verified"] = None          # nothing to check against
            kept.append(c)
        return kept

    async def _fetch_text(self, ctx: ToolCtx, url: str, timeout: float) -> str | None:
        """Fetch `url` and return its text, or None on any soft failure
        (error / timeout / too-thin extraction)."""
        try:
            result = await asyncio.wait_for(
                self._fetcher.call({"url": url, "max_chars": 200_000}, ctx),
                timeout=timeout,
            )
        except Exception:  # best-effort: a fetch error/timeout never blocks generation
            return None
        if result.is_error or not isinstance(result.content, dict):
            return None
        text = result.content.get("text") or ""
        if len(text) < _MIN_TEXT_FOR_ABSENCE:
            return None
        return text
