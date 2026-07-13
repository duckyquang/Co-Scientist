"""Tests for agent helper functions that don't require an LLM call."""

from __future__ import annotations

from types import SimpleNamespace

from co_scientist.agents.generation import _filter_to_seen_urls, _render_hypothesis_md
from co_scientist.agents.metareview import (
    _weave_figures,
    ensure_references,
    references_section,
)
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


def _hyp(hid: str, title: str, strategy: str, parents=None):
    return SimpleNamespace(id=hid, title=title, strategy=strategy, parent_ids=parents or [])


def _scores(n, c, t, f):
    return SimpleNamespace(novelty=n, correctness=c, testability=t, feasibility=f)


_PROSE = """# Research proposal

**Research goal.** Do the thing.

## The approach landscape

Strategies competed.

## Ranked proposals

Intro sentence before the proposals.

### Proposal 1. Alpha

Body.

## Comparative assessment

They differ.

## Recommended path and sequencing

Do A then B.

## Open questions and limitations

Caveats."""


def test_weave_figures_places_figures_in_upper_sections() -> None:
    top = [
        _hyp("H-a", "Alpha idea", "literature"),
        _hyp("H-b", "Beta idea", "debate", parents=["H-a"]),
    ]
    reviews = {
        "H-a": [SimpleNamespace(scores=_scores(0.9, 0.8, 0.7, 0.6))],
        "H-b": [SimpleNamespace(scores=_scores(0.5, 0.6, 0.7, 0.8))],
    }
    elo_series = {"H-a": [{"i": 0, "elo": 1216.0}], "H-b": [{"i": 0, "elo": 1184.0}]}
    labels = {"H-a": "Alpha idea", "H-b": "Beta idea"}

    out = _weave_figures(top, reviews, elo_series, labels, _PROSE)

    # Section anchors.
    i_landscape = out.index("## The approach landscape")
    i_ranked = out.index("## Ranked proposals")
    i_comparative = out.index("## Comparative assessment")
    i_recommended = out.index("## Recommended path")
    i_analysis = out.index("## Analysis")

    # Donut lands inside the approach landscape (before Ranked proposals).
    i_donut = out.index('"type": "donut"')
    assert i_landscape < i_donut < i_ranked
    # Scorecard lands inside Ranked proposals.
    i_scores = out.index('"type": "scores"')
    assert i_ranked < i_scores < i_comparative
    # Elo + lineage land inside Comparative assessment (before Recommended path).
    i_elo = out.index('"type": "elo"')
    i_mermaid = out.index("```mermaid")
    assert i_comparative < i_elo < i_recommended
    assert i_comparative < i_mermaid < i_recommended

    # A figure appears BEFORE the comparative section ends — not only at the bottom.
    assert i_donut < i_comparative

    # Numbered captions in document order.
    assert "*Fig. 1 —" in out and "*Fig. 2 —" in out
    # Rating model trails under a slim Analysis; References are added separately.
    assert i_analysis > i_recommended
    assert "R'_a" in out[i_analysis:]
    assert "## References" not in out


def test_weave_figures_unmatched_headings_go_to_analysis() -> None:
    # Prose missing the target headings → figures fall back to the trailing block.
    top = [_hyp("H-a", "Alpha", "literature")]
    reviews = {"H-a": [SimpleNamespace(scores=_scores(0.9, 0.8, 0.7, 0.6))]}
    out = _weave_figures(top, reviews, {}, {}, "# Overview\n\nJust prose, no sections.")
    i_analysis = out.index("## Analysis")
    # The donut/scorecard couldn't be placed, so they trail under Analysis.
    assert '"type": "donut"' in out[i_analysis:]
    assert '"type": "scores"' in out[i_analysis:]


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
