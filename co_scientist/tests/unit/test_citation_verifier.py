"""Source-side citation verification (no network — a stubbed WebFetch).

Covers every policy branch:
  - excerpt present            → verified True, kept
  - excerpt absent (readable)  → dropped
  - fetch failed (paywall)     → verified None, kept (flagged, not dropped)
  - thin extraction            → verified None, kept
  - doi uncorroborated         → doi blanked, url + citation kept
  - verifier disabled          → untouched (verified unset, nothing dropped)
  - fetch budget exhausted     → verified None, kept
and the meta-review consumer reading the STORED flag.
"""

from __future__ import annotations

from types import SimpleNamespace

from co_scientist.agents.metareview import MetaReviewAgent
from co_scientist.config import Config
from co_scientist.safety.citation_verifier import CitationVerifier
from co_scientist.tools.base import ToolResult

FILLER = "lorem ipsum dolor sit amet " * 40  # ~1080 chars, well over the thin-page floor


class FakeFetcher:
    """Maps url → page text; None means the fetch errored (paywall/network)."""

    def __init__(self, pages: dict[str, str | None]) -> None:
        self.pages = pages
        self.calls: list[str] = []

    async def call(self, args, ctx) -> ToolResult:
        url = args["url"]
        self.calls.append(url)
        text = self.pages.get(url)
        if text is None:
            return ToolResult(is_error=True, error_message="fetch failed")
        return ToolResult(content={"url": url, "text": text})


def _verifier(pages: dict[str, str | None], *, enabled: bool = True, budget: int = 8):
    cfg = Config()
    cfg.safety.enable_citation_verifier = enabled
    cfg.safety.citation_verify_max_fetches = budget
    v = CitationVerifier(cfg)
    v._fetcher = FakeFetcher(pages)  # type: ignore[attr-defined]
    return v, v._fetcher  # type: ignore[attr-defined]


async def test_excerpt_present_is_verified_true_and_doi_kept() -> None:
    url = "https://doi.org/10.1/abc"
    v, _ = _verifier({url: FILLER + " the key finding here " + FILLER})
    cite = {"title": "T", "url": url, "excerpt": "...the key finding here...", "doi": "10.1/abc"}
    out = await v.verify_citations("s1", [cite])
    assert len(out) == 1
    assert out[0]["verified"] is True
    assert out[0]["doi"] == "10.1/abc"  # corroborated by the doi.org url


async def test_excerpt_absent_on_readable_page_is_dropped() -> None:
    url = "https://ex.com/paper"
    v, _ = _verifier({url: FILLER})  # long readable page, quote is NOT in it
    cite = {"title": "T", "url": url, "excerpt": "this exact quote was fabricated", "doi": None}
    out = await v.verify_citations("s1", [cite])
    assert out == []  # hard hallucination — dropped


async def test_fetch_failure_is_flagged_not_dropped() -> None:
    url = "https://paywalled.example/paper"
    v, _ = _verifier({url: None})  # fetch errors (paywall / network)
    cite = {"title": "T", "url": url, "excerpt": "some real quote", "doi": None}
    out = await v.verify_citations("s1", [cite])
    assert len(out) == 1
    assert out[0]["verified"] is None  # kept, flagged unverified downstream


async def test_thin_extraction_is_flagged_not_dropped() -> None:
    url = "https://ex.com/stub"
    v, _ = _verifier({url: "too short to trust"})  # < 500 chars
    cite = {"title": "T", "url": url, "excerpt": "quote not present", "doi": None}
    out = await v.verify_citations("s1", [cite])
    assert len(out) == 1
    assert out[0]["verified"] is None


async def test_uncorroborated_doi_is_blanked_url_kept() -> None:
    url = "https://ex.com/paper"
    v, _ = _verifier({url: FILLER + " real quote text " + FILLER})  # page never names the doi
    cite = {"title": "T", "url": url, "excerpt": "real quote text", "doi": "10.9999/fake"}
    out = await v.verify_citations("s1", [cite])
    assert len(out) == 1
    assert out[0]["doi"] is None          # blanked
    assert out[0]["url"] == url           # real url preserved
    assert out[0]["verified"] is True     # excerpt still confirmed


async def test_doi_corroborated_by_page_text_is_kept() -> None:
    url = "https://ex.com/paper"
    v, _ = _verifier({url: FILLER + " doi:10.1234/xyz real quote " + FILLER})
    cite = {"title": "T", "url": url, "excerpt": "real quote", "doi": "10.1234/xyz"}
    out = await v.verify_citations("s1", [cite])
    assert out[0]["doi"] == "10.1234/xyz"  # page references it


async def test_disabled_verifier_leaves_citations_untouched() -> None:
    url = "https://ex.com/paper"
    v, fetcher = _verifier({url: FILLER}, enabled=False)
    cite = {"title": "T", "url": url, "excerpt": "fabricated quote", "doi": "10.9999/fake"}
    out = await v.verify_citations("s1", [cite])
    assert out == [cite]                  # nothing dropped
    assert "verified" not in out[0]       # flag stays unset (→ None on the model)
    assert out[0]["doi"] == "10.9999/fake"  # doi untouched
    assert fetcher.calls == []            # no network


async def test_fetch_budget_caps_verification() -> None:
    u1, u2 = "https://ex.com/a", "https://ex.com/b"
    page = FILLER + " shared quote " + FILLER
    v, fetcher = _verifier({u1: page, u2: page}, budget=1)
    cites = [
        {"title": "A", "url": u1, "excerpt": "shared quote", "doi": None},
        {"title": "B", "url": u2, "excerpt": "shared quote", "doi": None},
    ]
    out = await v.verify_citations("s1", cites)
    assert len(out) == 2                   # budget never drops, only stops checking
    assert out[0]["verified"] is True
    assert out[1]["verified"] is None      # beyond budget
    assert fetcher.calls == [u1]           # only one fetch happened


async def test_fetch_exception_is_swallowed_and_flagged() -> None:
    url = "https://ex.com/boom"

    class BoomFetcher:
        async def call(self, args, ctx):
            raise RuntimeError("unexpected fetch blowup")

    cfg = Config()
    v = CitationVerifier(cfg)
    v._fetcher = BoomFetcher()  # type: ignore[attr-defined]
    cite = {"title": "T", "url": url, "excerpt": "quote", "doi": None}
    out = await v.verify_citations("s1", [cite])  # must not raise
    assert len(out) == 1
    assert out[0]["verified"] is None  # soft-failed, kept


def test_metareview_unverified_urls_reads_stored_flag() -> None:
    cfg = Config()
    agent = SimpleNamespace(deps=SimpleNamespace(cfg=cfg))
    cites = [
        {"url": "u1", "doi": "d1", "verified": True},
        {"url": "u2", "doi": None, "verified": None},
        {"url": "u3", "doi": "d3", "verified": False},
    ]
    bad = MetaReviewAgent._unverified_urls(agent, cites)
    assert bad == frozenset({"u2", "u3", "d3"})  # verified-True excluded

    cfg.safety.enable_citation_verifier = False
    assert MetaReviewAgent._unverified_urls(agent, cites) == frozenset()
