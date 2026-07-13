"""Tests for agent helper functions that don't require an LLM call."""

from __future__ import annotations

from co_scientist.agents.generation import _filter_to_seen_urls, _render_hypothesis_md
from co_scientist.agents.metareview import ensure_references, references_section
from co_scientist.agents.reflection import _render_review_md

_CITES = [
    {"n": 1, "title": "Paper One", "url": "https://a.example/1",
     "doi": None, "year": 2021, "excerpt": None},
    {"n": 2, "title": "Paper Two", "url": None,
     "doi": "10.1000/xyz", "year": None, "excerpt": None},
]


def test_ensure_references_appends_when_missing() -> None:
    body = "# Research overview\n\nSome directions with an inline marker [1].\n"
    out = ensure_references(body, _CITES)
    assert "## References" in out
    assert "[1] Paper One (2021). https://a.example/1" in out
    assert "[2] Paper Two (n.d.). https://doi.org/10.1000/xyz" in out
    # original body is preserved
    assert "inline marker [1]" in out


def test_ensure_references_replaces_model_section() -> None:
    # A model-written (possibly invented) References block is replaced by the
    # authoritative one built from real data.
    body = "# Overview\n\nbody\n\n## References\n\n[1] Invented, never fetched (1999).\n"
    out = ensure_references(body, _CITES)
    assert "Invented, never fetched" not in out
    assert out.count("## References") == 1
    assert "[1] Paper One (2021)." in out


def test_ensure_references_honest_when_no_citations() -> None:
    body = "# Overview\n\nbody\n"
    out = ensure_references(body, [])
    assert "## References" in out
    assert "No verifiable citations were gathered." in out


def test_references_section_marks_unverified() -> None:
    out = references_section(_CITES, frozenset({"https://a.example/1"}))
    assert "[1] Paper One (2021). https://a.example/1 (unverified)" in out
    # the confirmed source is NOT marked
    assert "(unverified)" not in out.split("[2]")[1]


def test_citation_url_filter_keeps_only_seen() -> None:
    citations = [
        {"title": "A", "url": "https://a.example/paper1"},
        {"title": "B", "url": "https://hallucinated.example/paper2"},
        {"title": "C", "url": "https://c.example/paper3"},
        {"no_url": True},
    ]
    seen = {"https://a.example/paper1", "https://c.example/paper3"}
    out = _filter_to_seen_urls(citations, seen)
    urls = {c["url"] for c in out}
    assert urls == seen
    # hallucinated URL is dropped
    assert "https://hallucinated.example/paper2" not in urls


def test_hypothesis_md_renders_sections() -> None:
    md = _render_hypothesis_md(
        {
            "title": "T",
            "statement": "S",
            "mechanism": "M",
            "entities": ["E1", "E2"],
            "anticipated_outcomes": "AO",
            "novelty_argument": "N",
            "citations": [
                {"title": "Paper", "url": "https://example.com/x", "year": 2024}
            ],
        }
    )
    for marker in ("# T", "**Hypothesis.** S", "## Mechanism", "## Entities",
                   "## Anticipated outcomes", "## Novelty", "## Citations",
                   "https://example.com/x"):
        assert marker in md


def test_review_md_renders_sections() -> None:
    md = _render_review_md(
        {
            "verdict": "missing_piece",
            "novelty": 0.7, "correctness": 0.5, "testability": 0.6,
            "assumptions": [
                {"assumption": "A1", "plausibility": "plausible", "rationale": "R1"}
            ],
            "evidence": [
                {"claim": "claim1", "url": "https://e.example/p", "excerpt": "quote"}
            ],
            "notes": "n",
        }
    )
    assert "Verdict" in md
    assert "novelty 0.70" in md
    assert "plausible" in md
    assert "https://e.example/p" in md
    assert "n" in md


# ----------------------------- _thinking_text ----------------------------- #


class _Block:
    def __init__(self, type: str, **kw: str) -> None:
        self.type = type
        for k, v in kw.items():
            setattr(self, k, v)


class _Resp:
    def __init__(self, blocks: list[_Block]) -> None:
        self.raw = type("Raw", (), {"content": blocks})()


def test_thinking_text_joins_thinking_blocks() -> None:
    from co_scientist.agents.base import BaseAgent

    resp = _Resp([
        _Block("thinking", thinking="first thought"),
        _Block("text", text="visible answer"),
        _Block("thinking", thinking="second thought"),
    ])
    assert BaseAgent._thinking_text(resp) == "first thought\n\nsecond thought"


def test_thinking_text_empty_when_absent() -> None:
    from co_scientist.agents.base import BaseAgent

    assert BaseAgent._thinking_text(_Resp([_Block("text", text="hi")])) == ""
    assert BaseAgent._thinking_text(_Resp([])) == ""
