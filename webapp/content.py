"""Plausible-content generators shared by the seeder and the live simulator.

These produce realistic-looking hypotheses / reviews / overviews from a goal
string so the website is fully explorable without any LLM API key. The shapes
match what the real agents write to the DB.
"""

from __future__ import annotations

import hashlib
import json
import random
import re

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


def _mm_id(s: str) -> str:
    return "n" + "".join(c for c in s if c.isalnum())


def _cell(s: str) -> str:
    """Escape GFM table-cell delimiters so a '|' in a title can't shift columns."""
    return s.replace("|", "\\|")


def _analysis_block(goal: str, top: list[dict]) -> str:
    """Deterministic figures section (scorecard table + ```chart + strategy-mix
    donut + ```mermaid lineage + KaTeX). Mirrors the shared subset of
    frontend/src/lib/sim/content.ts buildAnalysis; the in-browser demo
    additionally shows an Elo-trajectory chart."""
    scored = []
    for p in top:
        sc = make_review(goal, p["title"], "full")["scores"]
        scored.append((p, sc))

    rows = "\n".join(
        f"| {i+1}. {_cell(p['title'][:40])} | {sc['novelty']:.2f} | {sc['correctness']:.2f} "
        f"| {sc['testability']:.2f} | {sc['feasibility']:.2f} |"
        for i, (p, sc) in enumerate(scored)
    )
    spec = {
        "type": "scores", "title": "Reviewer scores by proposal",
        "proposals": [
            {"label": f"{i+1}. {p['title'][:32]}", "scores": sc}
            for i, (p, sc) in enumerate(scored)
        ],
    }
    parts = [
        "## Analysis",
        "### Proposal scorecard\n\n"
        "Reviewer scores for each finalist (0–1; higher is better).\n\n"
        "| Proposal | Novelty | Correctness | Testability | Feasibility |\n"
        "|---|---|---|---|---|\n" + rows + "\n\n```chart\n" + json.dumps(spec) + "\n```",
    ]

    # Strategy mix → donut.
    strat_counts: dict = {}
    for p in top:
        s = p.get("strategy", "literature")
        strat_counts[s] = strat_counts.get(s, 0) + 1
    if strat_counts:
        entries = sorted(strat_counts.items(), key=lambda kv: -kv[1])
        srows = "\n".join(f"| {k} | {v} |" for k, v in entries)
        dspec = {"type": "donut", "title": "Hypotheses by generation strategy",
                 "segments": [{"label": k, "value": v} for k, v in entries]}
        parts.append(
            "### Where the ideas came from\n\n"
            "| Generation strategy | Hypotheses |\n|---|---|\n" + srows + "\n\n"
            "```chart\n" + json.dumps(dspec) + "\n```"
        )

    # Lineage (only when the proposals carry parent ids, e.g. seeded demo).
    ids_shown = {p.get("id") for p in top}
    if any(p.get("parent_ids") for p in top):
        nodes = "\n".join(
            f'  {_mm_id(p["id"])}["{p["title"].replace(chr(34), " ")[:30]}"]'
            for p in top if p.get("id")
        )
        edges = "\n".join(
            f'  {_mm_id(par)} --> {_mm_id(p["id"])}'
            for p in top for par in (p.get("parent_ids") or []) if par in ids_shown
        )
        parts.append(
            "### Idea lineage\n\n```mermaid\ngraph LR\n" + nodes
            + ("\n" + edges if edges else "") + "\n```"
        )

    parts.append(
        "### Rating model\n\n"
        "Each match updates a hypothesis's Elo rating $R$ by\n\n"
        r"$$R'_a = R_a + K\,(S_a - E_a), \qquad "
        r"E_a = \frac{1}{1 + 10^{(R_b - R_a)/400}}$$"
        "\n\nwhere $S_a \\in \\{0, 1\\}$ is the match outcome and $K$ is the update rate."
    )
    return "\n\n".join(parts)


def _overview_refs(top: list[dict]) -> tuple[list[dict], list[str]]:
    """Dedupe the proposals' fabricated citation objects into a numbered
    reference list, and return a parallel list of per-proposal inline `[n]`
    marker strings. Deduped by URL (fallback DOI) so repeated sources share a
    number. Real (well-formed, demo) citation data only — nothing extra invented
    here."""
    refs: list[dict] = []
    markers: list[str] = []
    key_to_n: dict[str, int] = {}
    for p in top:
        ns: list[int] = []
        for c in (p.get("citations") or []):
            key = (c.get("url") or c.get("doi") or "").strip()
            if not key:
                continue
            n = key_to_n.get(key)
            if n is None:
                n = len(refs) + 1
                key_to_n[key] = n
                refs.append({"n": n, **c})
            ns.append(n)
        markers.append("".join(f"[{n}]" for n in sorted(set(ns))))
    return refs, markers


def make_overview(goal: str, proposals: list[dict]) -> str:
    """Detailed research-proposal report. Mirrors the structure of the real
    metareview_final.md prompt (and frontend sim/content.ts makeOverview) so
    demo/sim output matches live output."""
    top = proposals[:5]
    lead = top[0] if top else None
    lead_title = lead["title"] if lead else "the top-ranked hypothesis"
    refs, markers = _overview_refs(top)
    references = "\n".join(
        f"[{c['n']}] {c.get('title') or 'Untitled'} ({c.get('year') or 'n.d.'}). "
        f"{c.get('url') or ('https://doi.org/' + c['doi'] if c.get('doi') else '')}".rstrip()
        for c in refs
    ) or "No verifiable citations were gathered."

    sections = []
    for i, p in enumerate(top):
        elo = round(p["elo"]) if p.get("elo") is not None else "—"
        mk = f" {markers[i]}" if markers[i] else ""
        sections.append(f"""### Proposal {i+1}. {p['title']}

**Tournament Elo:** {elo} · **Generation strategy:** `{p.get('strategy', 'literature')}`

**The hypothesis.** {p.get('summary', '').strip()}

**Why it's promising.**{mk} It survived repeated head-to-head debates against
competing ideas, and reviewers scored it well on novelty and testability. The
mechanism is specific enough to design a decisive experiment around.

**Proposed first experiment.** Stand up the relevant model system and apply the
intervention across a short dose range, reading out the primary phenotype with a
quantitative assay plus an orthogonal molecular signature. Include vehicle and a
mechanism-dead control so a positive result is interpretable.

**Feasibility and risks.** Achievable within a standard wet-lab budget and a
single quarter. The main risk is that the intervention does not reach an active
concentration in the relevant compartment — worth a pilot exposure check first.

**What would falsify it.** No dose-dependent shift in the primary readout at a
clinically achievable exposure, or rescue by the mechanism-dead control.""")
    body = "\n\n---\n\n".join(sections)

    return f"""# Research proposal

**Research goal.** {goal}

## Problem framing and significance

The goal above defines a question where a testable, mechanism-anchored answer
would materially change what a lab does next. Across a multi-agent tournament,
the system generated candidate hypotheses, critiqued them, and ranked them
head-to-head so that only ideas surviving repeated scrutiny rose to the top. The
proposals below are the survivors, ordered by tournament Elo.

## Executive summary

The tournament converged on {len(top)} strong candidate{'' if len(top) == 1 else 's'},
led by **{lead_title}**. The leading ideas share a bias toward interventions that
are testable with existing models and, where possible, repurpose known agents to
shorten the path from hypothesis to evidence.

## The approach landscape

Independent generation strategies (literature-grounded, debate-driven,
combination, and out-of-box) were each given room to explore, then forced to
compete. Where several strategies nominated the same mechanism, that convergence
is treated as a robustness signal rather than redundancy.

## Ranked proposals

{body}

## Comparative assessment

The top proposals are not interchangeable: some converge on a shared pathway
(mutually reinforcing evidence), while others are genuinely orthogonal bets worth
running in parallel to hedge mechanism risk. Prefer starting with the highest-Elo
idea that also has the cheapest decisive experiment.

## Recommended path and sequencing

1. Run the single cheapest decisive experiment for the top proposal first.
2. If it clears, add the orthogonal runner-up to hedge mechanism risk.
3. Pre-register every falsification threshold before wet-lab work begins.

## Open questions and limitations

Where the literature was thin, reviewer confidence is lower and a domain expert
is most likely to disagree — treat those proposals as exploratory. The tournament
optimizes for debate-survivability, not ground truth, so a high Elo is a strong
prior, not a proof.

{_analysis_block(goal, top)}

## References

{references}

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


# --------------------------------------------------------------------------- #
# Chat follow-up: intent routing + answers (canonical, shared by runtimes B & C)
# --------------------------------------------------------------------------- #

# Byte-exact reply for the out-of-scope intent. The server MUST emit this
# verbatim so the model can never paraphrase it.
OUT_OF_SCOPE = "Currently, Co-Scientist is unable to do this."

# External-action verbs Co-Scientist can't perform → out_of_scope. Kept
# deliberately specific so genuine questions ("summarize the findings", "in
# order to test this…") aren't mis-routed.
# ponytail: keyword heuristic, not intent classification — runtime C uses the LLM.
_EXTERNAL_RE = re.compile(
    r"\b(book|flight|hotel|email|e-mail|buy|purchase|checkout|pay|invest|patent|"
    r"deploy|hire|manufacture|order\s+(?:me|it|a|the)|call\s+(?:me|them|him|her))\b"
    r"|run the (?:wet-?lab|experiment)|send (?:an? )?(?:email|message|text)"
    r"|schedule (?:an? )?(?:meeting|call|appointment)",
    re.I,
)

# Tweak/update/fix verbs → tweak (spawn a new run).
_TWEAK_RE = re.compile(
    r"\b(change|update|tweak|fix|add|remove|modify|replace|improve|revise|refine|"
    r"instead|rather|swap|drop|extend|different|adjust|rework|rewrite|redo|"
    r"broaden|narrow|expand)\b",
    re.I,
)


def classify_intent(message: str) -> str:
    """Heuristic router: 'question' | 'tweak' | 'out_of_scope'.

    Defaults to 'question' (answer from data) rather than stonewalling — only
    explicit external-action words force out_of_scope.
    """
    m = message or ""
    if _EXTERNAL_RE.search(m):
        return "out_of_scope"
    if _TWEAK_RE.search(m):
        return "tweak"
    return "question"


def compose_rerun_goal(idea: str, change_request: str) -> str:
    """The verbatim rerun-goal template (identical across all runtimes)."""
    return (
        f"ORIGINAL IDEA: {idea}\n\n"
        f"FEEDBACK / CHANGE WANTED: {change_request}\n\n"
        "Suggest a new method based on the original idea and the feedback / change wanted."
    )


def top_idea(hyps: list[dict], goal: str) -> str:
    """`{title} — {summary}` of the top hypothesis, else the research goal."""
    if hyps:
        h = hyps[0]
        title = (h.get("title") or "").strip()
        summary = (h.get("summary") or "").strip()
        if title:
            return f"{title} — {summary}" if summary else title
    return goal


def make_chat_answer(goal: str, hyps: list[dict], overview: str = "") -> str:
    """Ground a 'question' answer in the session's leaderboard (top-5 table)."""
    if not hyps:
        return (
            "The run just started, so there are no hypotheses to discuss yet. "
            "Once the tournament produces a few ranked ideas, ask again and I'll "
            "walk you through the leaders."
        )
    top = hyps[:5]
    rows = "\n".join(
        "| `{id}` | {elo} | {state} | {title} |".format(
            id=h.get("id", "?"),
            elo=round(h["elo"]) if h.get("elo") is not None else "—",
            state=h.get("state", "—"),
            title=(h.get("title") or "").replace("|", "\\|"),
        )
        for h in top
    )
    leader = top[0]
    lead_elo = round(leader["elo"]) if leader.get("elo") is not None else "—"
    parts = [
        f"Here are the current top {len(top)} hypotheses for this session, "
        "ranked by tournament Elo:",
        "",
        "| id | Elo | state | title |",
        "|----|-----|-------|-------|",
        rows,
        "",
        f"The current leader is **{leader.get('title', '(untitled)')}** "
        f"(`{leader.get('id', '?')}`, Elo {lead_elo}). {leader.get('summary', '')}".strip(),
    ]
    return "\n".join(parts)


# --------------------------------------------------------------------------- #
# Recurring self-critique rounds (shared contract with sim/content.ts)
# --------------------------------------------------------------------------- #

# Concrete angles a meta-review round attacks the current leaders from. Each
# round rotates through these so the fabricated critique doesn't repeat.
_CRITIQUE_ANGLES = [
    ("citation integrity",
     "at least one supporting citation looks like a plausibility match rather "
     "than direct evidence — the cited result is adjacent, not confirmatory"),
    ("mechanistic gap",
     "the causal chain skips a step: the proposed lever and the measured "
     "outcome are linked by an intermediate that was never actually established"),
    ("confounding",
     "the predicted effect could be produced by an uncontrolled confounder, so "
     "a positive readout would not cleanly implicate the stated mechanism"),
    ("tournament overfitting",
     "this idea may be winning debates on rhetorical crispness rather than "
     "truth — its Elo reflects how it argues, not whether it is right"),
    ("external validity",
     "the effect is asserted for the model system but the leap to the real "
     "target population is doing a lot of unexamined work"),
    ("measurement validity",
     "the primary readout may be a proxy that moves for reasons unrelated to "
     "the phenomenon we actually care about"),
]


def make_self_critique(goal: str, round_no: int, top: list[dict]) -> str:
    """Fabricated meta-review self-critique for one recurring work round.

    Shared contract with the browser runtime (frontend/src/lib/sim/content.ts
    makeSelfCritique): returns markdown of the exact shape

        ## Thinking\n\n<reasoning>\n\n## Self-critique\n\n<critique>

    referencing the session's current top hypotheses. Deterministic (seeded by
    goal + round) so re-reads are stable; varies per round and per top set.
    """
    r = _rng(f"{goal}|self_critique|{round_no}")
    names = [(h.get("title") or "an untitled idea").strip() for h in top[:3]]
    lead = names[0] if names else "the current leader"
    runner = names[1] if len(names) > 1 else lead
    angle_name, angle_body = _CRITIQUE_ANGLES[(round_no - 1) % len(_CRITIQUE_ANGLES)]
    _alt_name, alt_body = r.choice(
        [a for a in _CRITIQUE_ANGLES if a[0] != angle_name] or _CRITIQUE_ANGLES
    )

    thinking = (
        f"Round {round_no}. I am re-reading the current leaderboard before trusting it.\n\n"
        f"1. The top-ranked idea is **{lead}**. I re-derive its claim from first "
        f"principles and ask whether the tournament rewarded it for being correct "
        f"or merely for being well-argued.\n"
        f"2. Its closest challenger is **{runner}**. I check whether the gap "
        f"between them is real signal or just noise from a handful of matches.\n"
        f"3. I walk each finalist's evidence back to its citations and ask, for "
        f"every link in the chain, *would this survive a domain expert?*\n"
        f"4. I list what a fresh round should probe that the last {round_no} "
        f"round(s) did not."
    )
    critique = (
        f"Are these actually the best hypotheses, or the best-defended? Looking "
        f"hard at **{lead}**, I am not convinced. The flaw this round is "
        f"**{angle_name}**: {angle_body}. That directly weakens the conclusion "
        f"the ranking leans on.\n\n"
        f"**{runner}** has a second problem — {alt_body}. If that holds, its "
        f"stated result may be over-claimed, and a citation or two are being "
        f"asked to carry more weight than they can bear.\n\n"
        f"Next round I will stress-test these specific doubts: re-examine the "
        f"weakest citation behind **{lead}**, probe the {angle_name} concern "
        f"with a sharper falsification, and let a re-rank decide whether the "
        f"current ordering actually holds up."
    )
    return f"## Thinking\n\n{thinking}\n\n## Self-critique\n\n{critique}"
