"""Chat follow-up: heuristic router + rerun-goal composition (runtimes A/B).

Runtime C swaps the keyword router for an LLM call, but the composed rerun goal
and the byte-exact out-of-scope reply are shared across all three, so they're
pinned here.
"""

from __future__ import annotations

from webapp import content


def test_out_of_scope_reply_is_byte_exact() -> None:
    assert content.OUT_OF_SCOPE == "Currently, Co-Scientist is unable to do this."


def test_classify_out_of_scope() -> None:
    for m in [
        "Book me a flight to Boston",
        "Email the results to my PI",
        "Buy the reagents for me",
        "Please run the wet-lab experiment",
    ]:
        assert content.classify_intent(m) == "out_of_scope", m


def test_classify_tweak() -> None:
    for m in [
        "Change the approach to use single-cell RNA-seq instead",
        "Update the proposal to focus on metabolic pathways",
        "Fix the third hypothesis, it's wrong",
        "Can you add a control arm?",
    ]:
        assert content.classify_intent(m) == "tweak", m


def test_classify_question_is_the_default() -> None:
    for m in [
        "What is the top hypothesis and why?",
        "Summarize the findings for me",  # 'summarize' must NOT trip external
        "In order to test this, what model would you use",  # 'order' must NOT trip
        "Tell me about the leaderboard",
    ]:
        assert content.classify_intent(m) == "question", m


def test_compose_rerun_goal_is_exact() -> None:
    goal = content.compose_rerun_goal(
        "Repurpose metformin — targets AMPK",
        "Use single-cell RNA-seq instead",
    )
    assert goal == (
        "ORIGINAL IDEA: Repurpose metformin — targets AMPK\n\n"
        "FEEDBACK / CHANGE WANTED: Use single-cell RNA-seq instead\n\n"
        "Suggest a new method based on the original idea and the feedback / change wanted."
    )


def test_top_idea_prefers_hypothesis_then_goal() -> None:
    hyps = [{"title": "Repurpose metformin", "summary": "targets AMPK"}]
    assert content.top_idea(hyps, "some goal") == "Repurpose metformin — targets AMPK"
    assert content.top_idea([], "some goal") == "some goal"


def test_make_chat_answer_has_table_and_leader() -> None:
    hyps = [
        {"id": "hyp_a", "elo": 1305.4, "state": "in_tournament",
         "title": "Idea A", "summary": "does a thing"},
        {"id": "hyp_b", "elo": 1201.0, "state": "in_tournament",
         "title": "Idea B", "summary": "does another"},
    ]
    md = content.make_chat_answer("the goal", hyps)
    assert "| id | Elo | state | title |" in md   # a markdown table
    assert "hyp_a" in md
    assert "1305" in md                            # elo rounded
    assert "Idea A" in md                          # leader referenced


def test_make_chat_answer_empty_state() -> None:
    md = content.make_chat_answer("the goal", [])
    assert "no hypotheses" in md.lower()
    assert "|" not in md                           # no table when empty
