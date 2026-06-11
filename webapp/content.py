"""Plausible-content generators shared by the seeder and the live simulator.

These produce realistic-looking hypotheses / reviews / overviews from a goal
string so the website is fully explorable without any LLM API key. The shapes
match what the real agents write to the DB.
"""

from __future__ import annotations

import hashlib
import random

STRATEGIES = [
    "literature", "debate", "combine", "simplify",
    "out_of_box", "feasibility", "assumption", "feedback_driven",
]

MODELS = {
    "generation": "claude-opus-4-7",
    "reflection": "claude-opus-4-7",
    "ranking": "claude-sonnet-4-6",
    "evolution": "claude-opus-4-7",
    "metareview": "claude-opus-4-7",
    "proximity": "voyage-3-large",
    "supervisor": "claude-sonnet-4-6",
}

# Templated mechanism fragments — combined to make distinct hypothesis bodies.
_MECHANISMS = [
    ("Repurposing {drug} via {pathway} modulation",
     "{drug} is a clinically approved agent whose off-target inhibition of "
     "{pathway} may suppress the disease-driving program identified in the goal."),
    ("{pathway} blockade reverses the {phenotype} phenotype",
     "Sustained {pathway} signaling maintains {phenotype}; pharmacological "
     "blockade should collapse the feed-forward loop and restore homeostasis."),
    ("Synthetic-lethal targeting of {gene} in {context}",
     "Cells in {context} become dependent on {gene}; a selective inhibitor "
     "exploits this dependency while sparing normal tissue."),
    ("{microbe}-derived metabolites drive {phenotype}",
     "Host exposure to {microbe} metabolites rewires {pathway}, providing a "
     "tractable, diet-modifiable lever over {phenotype}."),
    ("Combination of {drug} and {pathway} inhibition is synergistic",
     "Each agent alone is sub-therapeutic, but co-inhibition closes a "
     "compensatory escape route, predicting a strong synergy index."),
    ("Epigenetic priming sensitizes {context} to {drug}",
     "Low-dose epigenetic priming reopens silenced loci, restoring "
     "{drug} sensitivity in otherwise refractory {context}."),
]

_DRUGS = ["Nanvuranlat", "KIRA6", "Leflunomide", "Binimetinib", "Pacritinib",
          "Cerivastatin", "Dimethyl fumarate", "Metformin", "Disulfiram",
          "Niclosamide", "Auranofin", "Itraconazole"]
_PATHWAYS = ["IRE1α–XBP1", "DHODH", "MEK/ERK", "JAK2/STAT5", "mevalonate",
             "NRF2–KEAP1", "Wnt/β-catenin", "mTORC1", "ferroptosis", "cGAS–STING"]
_GENES = ["WRN", "PRMT5", "MAT2A", "USP1", "POLQ", "WEE1", "ATR"]
_PHENOTYPES = ["chronic inflammation", "drug tolerance", "stemness",
               "immune evasion", "fibrotic remodeling", "metabolic rewiring"]
_MICROBES = ["Akkermansia muciniphila", "Faecalibacterium prausnitzii",
             "Bacteroides fragilis", "segmented filamentous bacteria"]
_CONTEXTS = ["AML blasts", "senescent fibroblasts", "exhausted CD8 T cells",
             "drug-tolerant persister cells", "the inflamed gut epithelium"]

_JOURNALS = ["Nature", "Cell", "Science", "Nature Medicine", "Cell Metabolism",
             "Immunity", "Nature Cancer", "PNAS", "eLife", "Blood"]


def _rng(seed_text: str) -> random.Random:
    return random.Random(int(hashlib.sha256(seed_text.encode()).hexdigest()[:16], 16))


def make_hypothesis(goal: str, idx: int, strategy: str) -> dict:
    r = _rng(f"{goal}|{idx}|{strategy}")
    mech_title, mech_body = r.choice(_MECHANISMS)
    fill = {
        "drug": r.choice(_DRUGS),
        "pathway": r.choice(_PATHWAYS),
        "gene": r.choice(_GENES),
        "phenotype": r.choice(_PHENOTYPES),
        "microbe": r.choice(_MICROBES),
        "context": r.choice(_CONTEXTS),
    }
    title = mech_title.format(**fill)
    summary = (
        mech_body.format(**fill) + " The hypothesis is directly testable in "
        f"existing {fill['context']} models with a clear, quantitative readout."
    )
    full_text = f"""## Mechanism

{mech_body.format(**fill)}

We propose that **{fill['pathway']}** acts as the central node linking the
upstream stimulus to **{fill['phenotype']}** observed in {fill['context']}.

## Rationale

1. Genetic perturbation of {fill['gene']} phenocopies the proposed intervention.
2. {fill['drug']} is already approved, de-risking translation and toxicity.
3. The pathway is druggable with sub-micromolar tool compounds.

## Proposed experiment

- **Model:** {fill['context']} (primary + isogenic line).
- **Intervention:** titrate {fill['drug']} ± {fill['pathway']} inhibitor.
- **Primary readout:** reversal of {fill['phenotype']} signature (RNA-seq + functional assay).
- **Controls:** vehicle, isotype, and a pathway-dead mutant rescue.
- **Success criterion:** >50% reduction in the {fill['phenotype']} score at a
  clinically achievable exposure.

## Predicted outcome

A dose-dependent collapse of the {fill['phenotype']} program with an
EC50 within the approved therapeutic window of {fill['drug']}.
"""
    citations = []
    for _ in range(r.randint(2, 4)):
        yr = r.randint(2018, 2025)
        citations.append({
            "title": f"{fill['pathway']} regulates {fill['phenotype']} in {fill['context'].split()[0]} models",
            "url": f"https://doi.org/10.1038/s{r.randint(40000,49999)}-0{yr-2000}-{r.randint(1000,9999)}-x",
            "excerpt": f"...inhibition of {fill['pathway']} reduced {fill['phenotype']} markers by {r.randint(40,80)}%...",
            "doi": f"10.1038/s{r.randint(40000,49999)}",
            "year": yr,
        })
    return {
        "title": title, "summary": summary, "full_text": full_text,
        "citations": citations, "strategy": strategy,
    }


def make_review(goal: str, hyp_title: str, kind: str) -> dict:
    r = _rng(f"{goal}|{hyp_title}|{kind}")
    verdict = r.choice(
        ["neutral", "missing_piece", "already_explained", "other_more_likely"]
    )
    scores = {
        "novelty": round(r.uniform(0.45, 0.95), 2),
        "correctness": round(r.uniform(0.5, 0.95), 2),
        "testability": round(r.uniform(0.55, 0.98), 2),
        "feasibility": round(r.uniform(0.4, 0.9), 2),
    }
    body = f"""**Verdict:** {verdict}

**Novelty ({scores['novelty']}).** The mechanistic link is under-explored; a
handful of adjacent papers exist but none test this exact intervention.

**Correctness ({scores['correctness']}).** Internally consistent. The proposed
causal chain is plausible given the cited evidence, though one upstream step
relies on an assumption flagged below.

**Testability ({scores['testability']}).** Strong — the readout is quantitative
and the reagents are commercially available.

**Feasibility ({scores['feasibility']}).** Achievable within a standard wet-lab
budget; the main risk is compound exposure in the relevant compartment.

**Key assumption checked:** that the approved agent reaches the target tissue at
an active concentration. Rated *{r.choice(['plausible', 'uncertain'])}*.
"""
    return {"kind": kind, "verdict": verdict, "scores": scores, "body": body}


def make_overview(goal: str, top_titles: list[str]) -> str:
    bullets = "\n".join(
        f"{i+1}. **{t}** — ranked by tournament Elo; survives deep verification "
        f"and is ready for experimental triage." for i, t in enumerate(top_titles[:5])
    )
    return f"""# Research overview

**Goal.** {goal}

## Executive summary

Across the tournament, the system explored a diverse hypothesis space and
converged on a small set of high-Elo, deeply-verified candidates. The leading
hypotheses share a common theme: actionable, mechanism-anchored interventions
that are testable with existing models and, where possible, repurpose
clinically approved agents to de-risk translation.

## Top-ranked hypotheses

{bullets}

## Cross-cutting themes

- **Repurposing over de-novo discovery.** The highest-ranked ideas lean on
  approved compounds, trading some novelty for a dramatically shorter path to
  the clinic.
- **Pathway convergence.** Independent generation strategies repeatedly nominated
  the same signaling hubs, a useful signal of robustness.
- **Clear falsification criteria.** Every surviving hypothesis specifies a
  quantitative success threshold, which is what let the Ranking agent separate
  them under debate.

## Recommended next steps

1. Triage the top-3 candidates in the cheapest available model first.
2. Run the proposed combination arm early — synergy, if real, is the highest-value outcome.
3. Pre-register the falsification thresholds before wet-lab work begins.

*Generated by the Meta-review agent after Elo stabilization.*
"""


def make_plan(goal: str) -> dict:
    r = _rng(goal)
    return {
        "objective": goal,
        "preferences": r.sample(
            ["prioritize testable mechanisms", "favor drug repurposing",
             "emphasize novelty", "require quantitative readouts",
             "avoid CBRN-adjacent directions"], 3),
        "constraints": r.sample(
            ["existing models only", "clinically approved agents preferred",
             "budget-bounded wet-lab", "no human-subjects work"], 2),
        "idea_attributes": ["mechanistic", "testable", "novel", "feasible"],
        "domain_hint": "biomedicine",
        "notes": "Auto-parsed research plan.",
    }
