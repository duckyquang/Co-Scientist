"""Hypothesis model — the central artifact."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

HypothesisState = Literal[
    "draft", "reviewed", "in_tournament", "pinned", "rejected", "quarantined", "retired"
]
HypothesisStrategy = Literal[
    "literature", "debate", "combine", "simplify", "out_of_box", "feasibility", "assumption",
    "feedback_driven",
]
HypothesisOrigin = Literal["generation", "evolution"]


class CitedPaper(BaseModel):
    title: str
    url: str
    excerpt: str | None = None
    doi: str | None = None
    year: int | None = None
    # Set by the citation verifier at generation/evolution time:
    #   True  — excerpt confirmed on the fetched page
    #   False — page readable but excerpt absent (fabricated quote)
    #   None  — not checked (verifier disabled / fetch failed / budget spent)
    verified: bool | None = None


class Hypothesis(BaseModel):
    id: str
    session_id: str
    created_at: datetime
    created_by: HypothesisOrigin
    strategy: HypothesisStrategy
    parent_ids: list[str] = Field(default_factory=list)
    title: str
    summary: str                 # ~3 sentences; what's embedded for proximity
    full_text: str               # detailed markdown for domain experts
    # Real extended-thinking the agent produced while generating/evolving this
    # hypothesis (None when the model emitted no thinking). Surfaced in the UI.
    thinking: str | None = None
    citations: list[CitedPaper] = Field(default_factory=list)
    artifact_path: str           # relative under data_dir
    elo: float | None = None
    matches_played: int = 0
    state: HypothesisState = "draft"
    dedup_cluster: str | None = None
