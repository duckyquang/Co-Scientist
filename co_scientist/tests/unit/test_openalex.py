"""Unit tests for OpenAlex parsing (pure, no network)."""

from __future__ import annotations

from co_scientist.tools.builtins.openalex import _parse_openalex, _reconstruct_abstract

# Captured-shape sample: one work with a DOI + inverted-index abstract,
# one with only an OpenAlex id (no DOI), one junk row with neither (skipped).
SAMPLE = {
    "meta": {"count": 2},
    "results": [
        {
            "id": "https://openalex.org/W111",
            "doi": "https://doi.org/10.1234/gut.2020.42",
            "title": "Gut microbiome and obesity",
            "publication_year": 2020,
            "authorships": [
                {"author": {"display_name": "Ada Lovelace"}},
                {"author": {"display_name": "Alan Turing"}},
            ],
            "primary_location": {"source": {"display_name": "Nature Metabolism"}},
            "abstract_inverted_index": {
                "The": [0],
                "gut": [1],
                "microbiome": [2],
                "affects": [3],
                "obesity": [4],
            },
        },
        {
            "id": "https://openalex.org/W222",
            "doi": None,
            "title": "A preprint without a DOI",
            "publication_year": 2023,
            "authorships": [{"author": {"display_name": "Grace Hopper"}}],
            "primary_location": {"source": None},
            "abstract_inverted_index": None,
        },
        {"id": None, "doi": None, "title": "junk"},
    ],
}


def test_parse_openalex_shape_and_url_construction() -> None:
    results = _parse_openalex(SAMPLE)
    assert len(results) == 2  # junk row (no id, no doi) skipped

    a = results[0]
    assert a["title"] == "Gut microbiome and obesity"
    assert a["doi"] == "10.1234/gut.2020.42"  # bare form, prefix stripped
    assert a["url"] == "https://doi.org/10.1234/gut.2020.42"  # url = doi.org link
    assert a["year"] == 2020
    assert a["authors"] == ["Ada Lovelace", "Alan Turing"]
    assert a["venue"] == "Nature Metabolism"
    assert a["abs_url"] == "https://openalex.org/W111"
    assert a["abstract"] == "The gut microbiome affects obesity"

    b = results[1]
    assert b["doi"] is None
    assert b["url"] == "https://openalex.org/W222"  # falls back to landing id
    assert b["abs_url"] == "https://openalex.org/W222"
    assert b["venue"] is None
    assert b["abstract"] == ""


def test_reconstruct_abstract_orders_by_position() -> None:
    inverted = {"world": [1], "hello": [0], "again": [2, 4], "hello2": [3]}
    assert _reconstruct_abstract(inverted) == "hello world again hello2 again"
    assert _reconstruct_abstract(None) == ""
    assert _reconstruct_abstract({}) == ""
