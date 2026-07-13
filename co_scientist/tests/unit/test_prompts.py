"""Prompt rendering smoke."""

from __future__ import annotations

import pytest

from co_scientist.llm import prompts


def test_all_templates_exist_on_disk() -> None:
    for key in prompts.TEMPLATES:
        p = prompts.template_path(key)
        assert p.exists(), f"missing template file for {key}: {p}"


def test_render_parse_goal() -> None:
    out = prompts.render(
        "parse_goal",
        goal="Investigate how X causes Y in mammalian cells",
        preferences_text="testable, specific",
    )
    assert "Investigate how X causes Y" in out
    assert "testable, specific" in out


def test_render_generation_literature() -> None:
    out = prompts.render(
        "generation.literature",
        goal="goal",
        preferences="prefs",
        articles_with_reasoning="(articles)",
    )
    assert "Goal: goal" in out
    assert "(articles)" in out
    assert "record_hypothesis" in out


def test_render_ranking_pairwise() -> None:
    out = prompts.render(
        "ranking.pairwise",
        goal="g",
        idea_attributes="novel, testable",
        hypothesis_1="H1 prose",
        hypothesis_1_id="H1",
        hypothesis_2="H2 prose",
        hypothesis_2_id="H2",
        review_1="R1",
        review_2="R2",
    )
    assert "better idea: <1 or 2>" in out
    assert "H1 prose" in out


def test_render_metareview_final_includes_citation_list() -> None:
    from co_scientist.agents.metareview import citations_prompt_block

    cites = [
        {"n": 1, "title": "Paper One", "url": "https://a.example/1",
         "doi": None, "year": 2021, "excerpt": None},
        {"n": 2, "title": "Paper Two", "url": None,
         "doi": "10.1000/xyz", "year": None, "excerpt": None},
    ]
    out = prompts.render(
        "metareview.final",
        goal="g", preferences="p", system_feedback="",
        top_hypotheses_block="(hyps)",
        citations_block=citations_prompt_block(cites),
    )
    # The numbered list the model must cite from is present in the prompt.
    assert "[1] Paper One (2021). https://a.example/1" in out
    assert "[2] Paper Two (n.d.). https://doi.org/10.1000/xyz" in out
    assert "Cite ONLY from the numbered" in out


def test_render_unknown_template_raises() -> None:
    with pytest.raises(KeyError):
        prompts.render("nonexistent.template")
