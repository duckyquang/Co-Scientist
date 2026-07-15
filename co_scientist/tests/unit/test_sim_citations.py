"""The keyless simulator must cite only REAL, resolving papers — never random
DOIs. Guards against a regression to the old fabricated-DOI behaviour."""

from __future__ import annotations


def test_make_hypothesis_cites_only_curated_real_papers() -> None:
    from webapp.content import _REAL_PAPERS, make_hypothesis

    real_dois = {p["doi"] for p in _REAL_PAPERS}
    for idx in range(8):
        hyp = make_hypothesis("reduce chronic inflammation in the gut", idx, "literature")
        cites = hyp["citations"]
        assert 2 <= len(cites) <= 4
        seen = set()
        for c in cites:
            assert c["doi"] in real_dois            # no invented DOIs
            assert c["url"] == "https://doi.org/" + c["doi"]  # url and doi agree
            assert c["doi"] not in seen             # distinct within a hypothesis
            seen.add(c["doi"])


def test_real_papers_dois_are_wellformed() -> None:
    from webapp.content import _REAL_PAPERS

    assert len(_REAL_PAPERS) >= 15
    assert len({p["doi"] for p in _REAL_PAPERS}) == len(_REAL_PAPERS)  # no dupes
    for p in _REAL_PAPERS:
        assert p["doi"].startswith("10.")          # valid DOI prefix
        assert p["title"] and p["year"]
