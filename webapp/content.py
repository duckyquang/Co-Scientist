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
    ctx = fill["context"].split()[0]
    cite_titles = [
        f"{fill['pathway']} regulates {fill['phenotype']} in {ctx} models",
        f"A systematic review of {fill['drug']} targeting {fill['pathway']}",
        f"{fill['gene']} loss shifts the {fill['phenotype']} program in {ctx}",
        f"Druggability of {fill['pathway']}: tool compounds and {fill['phenotype']} readouts",
    ]
    citations = []
    for i in range(r.randint(2, 4)):
        yr = r.randint(2018, 2025)
        citations.append({
            "title": cite_titles[i % len(cite_titles)],
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


_MM_STRIP = re.compile(r'[\[\]"#|<>{}()]')


def _mm_label(s: str) -> str:
    """Mermaid-safe node label: strip the chars that break strict-mode parsing,
    collapse whitespace, clip to 30 at a word boundary when there is one."""
    s = re.sub(r"\s+", " ", _MM_STRIP.sub("", s or "")).strip()
    if len(s) > 30:
        cut = s[:30]
        sp = cut.rfind(" ")
        s = (cut[:sp] if sp > 0 else cut).rstrip()
    return s


def _cell(s: str) -> str:
    """Escape GFM table-cell delimiters so a '|' in a title can't shift columns."""
    return s.replace("|", "\\|")


# ---------------------------- figure helpers ------------------------------ #
# Each returns a self-contained markdown figure body (table + ```chart, or a
# ```mermaid graph) or None. `_figure_set` numbers them in document order and
# adds captions; `make_overview` splices each into its matching upper section.
# Mirrors the shared subset of frontend/src/lib/sim/content.ts.

_RATING_MODEL_NOTE = (
    "### Rating model\n\n"
    "Each match updates a hypothesis's Elo rating $R$ by\n\n"
    r"$$R'_a = R_a + K\,(S_a - E_a), \qquad "
    r"E_a = \frac{1}{1 + 10^{(R_b - R_a)/400}}$$"
    "\n\nwhere $S_a \\in \\{0, 1\\}$ is the match outcome and $K$ is the update "
    "rate. Each idea enters the tournament seeded between 1000 and 1800 by "
    "review quality, so ratings spread toward the 1000-2000 band as matches "
    "accumulate."
)


def _scorecard_body(goal: str, top: list[dict]) -> str | None:
    scored = [(p, make_review(goal, p["title"], "full")["scores"]) for p in top]
    if not scored:
        return None
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
    return (
        "| Proposal | Novelty | Correctness | Testability | Feasibility |\n"
        "|---|---|---|---|---|\n" + rows + "\n\n```chart\n" + json.dumps(spec) + "\n```"
    )


def _donut_body(top: list[dict]) -> str | None:
    strat_counts: dict = {}
    for p in top:
        s = p.get("strategy", "literature")
        strat_counts[s] = strat_counts.get(s, 0) + 1
    if not strat_counts:
        return None
    entries = sorted(strat_counts.items(), key=lambda kv: -kv[1])
    srows = "\n".join(f"| {k} | {v} |" for k, v in entries)
    dspec = {"type": "donut", "title": "Hypotheses by generation strategy",
             "segments": [{"label": k, "value": v} for k, v in entries]}
    return (
        "| Generation strategy | Hypotheses |\n|---|---|\n" + srows + "\n\n"
        "```chart\n" + json.dumps(dspec) + "\n```"
    )


def _lineage_body(nodes: list[dict], anchor_ids: set, cap: int = 12) -> str | None:
    """Mermaid graph of the evolvement chains that lead into a top proposal.

    Build parent→child edges among `nodes` (any hypothesis whose parent is also a
    known node), walking ancestors up from each `anchor_id` so a chain like
    root→child→top stays visible even when the ancestors are not top-ranked. Emit
    ONLY nodes touched by ≥1 edge (orphans dropped); return None when there are no
    edges. `nodes` need parent_ids (the seeded demo / live-sim supply them);
    without any there are no edges and the figure is omitted."""
    by_id = {p["id"]: p for p in nodes if p.get("id")}
    order: list[str] = []
    seen: set = set()
    edges: list[tuple[str, str]] = []
    seen_edges: set = set()
    frontier = [a for a in anchor_ids if a in by_id]
    while frontier and len(seen) < cap:
        nid = frontier.pop(0)
        if nid not in seen:
            seen.add(nid)
            order.append(nid)
        for par in (by_id[nid].get("parent_ids") or []):
            if par not in by_id or par == nid:
                continue
            e = (par, nid)
            if e not in seen_edges:
                seen_edges.add(e)
                edges.append(e)
            if par not in seen:          # enqueue each node once → always terminates
                seen.add(par)
                order.append(par)
                frontier.append(par)
    if not edges:
        return None
    touched = {n for e in edges for n in e}
    node_lines = "\n".join(
        f'  {_mm_id(n)}["{_mm_label(by_id[n]["title"])}"]' for n in order if n in touched
    )
    edge_lines = "\n".join(f"  {_mm_id(p)} --> {_mm_id(c)}" for p, c in edges)
    return "```mermaid\ngraph LR\n" + node_lines + "\n" + edge_lines + "\n```"


def _figure_set(goal: str, top: list[dict], lineage_nodes: list[dict]) -> dict[str, str]:
    """Numbered, captioned figure blocks keyed by placement. Empty string when a
    figure has no data (splices in cleanly). Numbered in document order. The donut
    and scorecard describe the top proposals; lineage resolves ancestry over the
    fuller `lineage_nodes` set (so an evolvement chain into a top proposal shows
    even when its ancestors are not top-ranked)."""
    n = 0

    def cap(body: str | None, text: str) -> str:
        nonlocal n
        if not body:
            return ""
        n += 1
        return f"{body}\n\n*Fig. {n} — {text}*"

    anchors = {p["id"] for p in top if p.get("id")}
    return {
        "donut": cap(_donut_body(top),
                     "share of the finalist hypotheses by generation strategy."),
        "scores": cap(_scorecard_body(goal, top),
                      "reviewer scores across the four dimensions for each finalist."),
        "lineage": cap(_lineage_body(lineage_nodes, anchors),
                       "idea lineage — the evolvement chain bred into each top proposal."),
    }


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


# ------------------ per-proposal (unnumbered) figure helpers ---------------- #
# These sit at the END of each top-3 `### Proposal N` block. They are deliberately
# UNNUMBERED (no Fig.N caption) so the document-level Fig.N numbering in
# `_figure_set` stays monotonic. Each carries a chart/mermaid title instead.

_PIPELINE_FIELDS = (
    ("Model", re.compile(r"\*\*(?:Model|Method):\*\*\s*([^\n]+)", re.I)),
    ("Intervention", re.compile(r"\*\*Intervention:\*\*\s*([^\n]+)", re.I)),
    ("Readout", re.compile(r"\*\*Primary readout:\*\*\s*([^\n]+)", re.I)),
    ("Success", re.compile(r"\*\*Success criterion:\*\*\s*([^\n]+)", re.I)),
)


def _mm_node_text(s: str) -> str:
    """Strip chars that break a quoted mermaid node label, collapse whitespace,
    and clip. Keeps unicode (±, –) which mermaid renders fine inside quotes."""
    s = re.sub(r'[\[\]"#|<>{}()]', "", s or "")
    s = re.sub(r"\s+", " ", s).strip()
    return s[:38].rstrip(" .,;:-")


def _proposal_pipeline_body(full_text: str, summary: str, n: int) -> str:
    """Model→Intervention→Readout→Success pipeline mermaid, parsed from the
    fixed-template proposal body. Per-field fallbacks keep it robust when the
    body is missing (e.g. the live simulator's hyps carry no full_text)."""
    fallbacks = {
        "Model": "Model system",
        "Intervention": _mm_node_text(summary) or "Intervention",
        "Readout": "Primary readout",
        "Success": "Success threshold",
    }
    nodes = []
    for label, rx in _PIPELINE_FIELDS:
        m = rx.search(full_text or "")
        val = (_mm_node_text(m.group(1)) if m else "") or fallbacks[label]
        nodes.append((label, val))
    lines = [f'  n{i}["{lbl}: {val}"]' for i, (lbl, val) in enumerate(nodes)]
    edges = [f"  n{i} --> n{i + 1}" for i in range(len(nodes) - 1)]
    return (
        "```mermaid\n---\n"
        f"title: Prototype experiment pipeline — proposal {n}\n---\n"
        "graph LR\n" + "\n".join(lines + edges) + "\n```"
    )


def _proposal_citation_donut_body(citations: list | None, n: int) -> str | None:
    """Mini-donut of the proposal's own cited sources grouped by year. None when
    the proposal carries no citations (the figure then splices in cleanly)."""
    cites = citations or []
    if not cites:
        return None
    counts: dict[str, int] = {}
    for c in cites:
        yr = str(c.get("year") or "n.d.")
        counts[yr] = counts.get(yr, 0) + 1
    entries = sorted(counts.items(), key=lambda kv: (kv[0] == "n.d.", kv[0]))
    rows = "\n".join(f"| {_cell(k)} | {v} |" for k, v in entries)
    spec = {"type": "donut", "title": f"Cited sources by year — proposal {n}",
            "segments": [{"label": k, "value": v} for k, v in entries]}
    return (
        "| Publication year | Sources |\n|---|---|\n" + rows + "\n\n"
        "```chart\n" + json.dumps(spec) + "\n```"
    )


def make_overview(goal: str, proposals: list[dict]) -> str:
    """Detailed research-proposal report. Mirrors the structure of the real
    metareview_final.md prompt (and frontend sim/content.ts makeOverview) so
    demo/sim output matches live output."""
    top = proposals[:3]
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
        # Per-proposal illustrations for the top-3: a compact score radar on the
        # Elo line, plus an experiment-pipeline mermaid and a citations mini-donut
        # at the END of the block. All UNNUMBERED (chart title only) so the
        # section-level Fig.N numbering stays monotonic.
        radar = ""
        end_figs: list[str] = []
        if i < 3:
            sc = make_review(goal, p["title"], "full")["scores"]
            rspec = {"type": "radar", "title": f"Score profile — proposal {i+1}", "scores": sc}
            radar = "\n\n```chart\n" + json.dumps(rspec) + "\n```"
            end_figs.append(_proposal_pipeline_body(p.get("full_text", ""), p.get("summary", ""), i + 1))
            donut = _proposal_citation_donut_body(p.get("citations"), i + 1)
            if donut:
                end_figs.append(donut)
        tail = ("\n\n" + "\n\n".join(end_figs)) if end_figs else ""
        sections.append(f"""### Proposal {i+1}. {p['title']}

**Tournament Elo:** {elo} · **Generation strategy:** `{p.get('strategy', 'literature')}`{radar}

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
clinically achievable exposure, or rescue by the mechanism-dead control.{tail}""")
    body = "\n\n---\n\n".join(sections)

    # Content figures woven into the relevant upper sections (empty strings when
    # a figure has no data). A slim rating-model note trails under "## Analysis".
    figs = _figure_set(goal, top, proposals)
    donut = f"\n\n{figs['donut']}" if figs["donut"] else ""
    scores = f"{figs['scores']}\n\n" if figs["scores"] else ""
    lineage = f"\n\n{figs['lineage']}" if figs["lineage"] else ""

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
is treated as a robustness signal rather than redundancy.{donut}

## Ranked proposals

{scores}{body}

## Comparative assessment

The top proposals are not interchangeable: some converge on a shared pathway
(mutually reinforcing evidence), while others are genuinely orthogonal bets worth
running in parallel to hedge mechanism risk. Prefer starting with the highest-Elo
idea that also has the cheapest decisive experiment.{lineage}

## Recommended path and sequencing

1. Run the single cheapest decisive experiment for the top proposal first.
2. If it clears, add the orthogonal runner-up to hedge mechanism risk.
3. Pre-register every falsification threshold before wet-lab work begins.

## Open questions and limitations

Where the literature was thin, reviewer confidence is lower and a domain expert
is most likely to disagree — treat those proposals as exploratory. The tournament
optimizes for debate-survivability, not ground truth, so a high Elo is a strong
prior, not a proof.

## Analysis

{_RATING_MODEL_NOTE}

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
# round rotates through these (and targets a DIFFERENT hypothesis) so no two
# rounds read alike. Fields: name, body, threat (why this axis, tied to a soft
# review score, threatens the idea), probes (angle-specific thinking steps).
_CRITIQUE_ANGLES = [
    {
        "name": "citation integrity",
        "body": "at least one supporting citation looks like a plausibility match "
                "rather than direct evidence — the cited result is adjacent, not "
                "confirmatory",
        "threat": "a ranking that leans on those citations is leaning on the "
                  "weakest part of the file",
        "probes": [
            "Sort every citation behind it into *direct evidence* vs "
            "*plausible-adjacent* — a claim resting on the second pile is "
            "resting on vibes.",
            "For the single load-bearing reference, check whether it measured "
            "*this* effect or a cousin of it.",
            "Ask whether the summary's confidence was inherited from the cited "
            "papers or quietly added in the retelling.",
        ],
    },
    {
        "name": "mechanistic gap",
        "body": "the causal chain skips a step: the proposed lever and the "
                "measured outcome are linked by an intermediate that was never "
                "actually established",
        "threat": "a mechanism with an undemonstrated step cannot honestly be "
                  "scored as settled",
        "probes": [
            "Draw its causal chain as arrows and mark the one arrow nobody has "
            "actually demonstrated.",
            "Ask whether the lever and the outcome are separated by an "
            "intermediate that is assumed, not shown.",
            "Check whether a positive result would confirm *this* mechanism or "
            "merely be consistent with three others.",
        ],
    },
    {
        "name": "confounding",
        "body": "the predicted effect could be produced by an uncontrolled "
                "confounder, so a positive readout would not cleanly implicate "
                "the stated mechanism",
        "threat": "an uncontrolled confounder means a positive result would not "
                  "cleanly earn that score",
        "probes": [
            "List every variable that moves alongside the intervention and could "
            "produce the same readout.",
            "Ask which of those the proposed control actually neutralises — and "
            "which it quietly leaves open.",
            "Decide whether a clean positive still implicates the stated "
            "mechanism, or just correlates with it.",
        ],
    },
    {
        "name": "tournament overfitting",
        "body": "this idea may be winning debates on rhetorical crispness rather "
                "than truth — its Elo reflects how it argues, not whether it is "
                "right",
        "threat": "a rating built on debate wins is not the same thing as being "
                  "correct",
        "probes": [
            "Separate *how well it argues* from *whether it is right* — the Elo "
            "only ever sees the first.",
            "Re-read its winning matches: did it beat rivals on evidence or on "
            "rhetorical crispness?",
            "Ask whether a skeptical domain expert, not a debate judge, would "
            "still rank it first.",
        ],
    },
    {
        "name": "external validity",
        "body": "the effect is asserted for the model system but the leap to the "
                "real target population is doing a lot of unexamined work",
        "threat": "an effect that only holds in the toy setting does not deserve "
                  "a top rank for the real goal",
        "probes": [
            "Trace the leap from the model system to the real target population "
            "and name what changes across that gap.",
            "Ask which assumptions hold in the toy setting but quietly break at "
            "scale.",
            "Decide whether the effect size would survive the messiness the "
            "model omits.",
        ],
    },
    {
        "name": "measurement validity",
        "body": "the primary readout may be a proxy that moves for reasons "
                "unrelated to the phenomenon we actually care about",
        "threat": "a proxy readout can inflate every downstream number, "
                  "including this one",
        "probes": [
            "Ask whether the primary readout *is* the phenomenon or a proxy "
            "standing in for it.",
            "List the unrelated reasons that proxy could move, and whether any "
            "is likelier than the claimed cause.",
            "Check whether an orthogonal readout would agree — or expose the "
            "proxy.",
        ],
    },
]

# Rotating opener/closer sets so the critique's framing differs every round.
_CRITIQUE_OPENERS = [
    "Are these the best hypotheses, or merely the best-defended?",
    "Before I trust this leaderboard, I want to try to knock the top idea off it.",
    "A high Elo is a strong prior, not a proof — so I am reading against the "
    "ranking, not with it.",
    "The tournament rewards survivability, not truth; this round I press on the "
    "difference.",
    "If the ordering is right, it should survive me actively trying to break it.",
    "I keep asking the same uncomfortable question: what would make the current "
    "leader wrong?",
]
_CRITIQUE_CLOSERS = [
    "Next round I hand these doubts to the re-rank and let fresh matches decide "
    "whether the ordering holds.",
    "I will turn this into a sharper falsification and see if the Elo gap "
    "survives it.",
    "The stress-test stage should target exactly this weak axis before anyone "
    "commits resources.",
    "If the concern is real, a low-K re-rank will start eroding the gap; if not, "
    "the idea earns its place.",
    "I am logging this as the specific thing the next round must probe, not a "
    "vague unease.",
    "Either the idea absorbs this critique or it drops — the re-rank will tell "
    "us which.",
]

_REVIEW_DIMS = ("novelty", "correctness", "testability", "feasibility")


def _elo_txt(elo) -> str:
    return "unranked" if elo is None else f"Elo {round(elo)}"


def make_self_critique(goal: str, round_no: int, top: list[dict]) -> str:
    """Fabricated meta-review self-critique for one recurring work round.

    Shared contract with the browser runtime (frontend/src/lib/sim/content.ts
    makeSelfCritique): returns markdown of the exact shape

        ## Thinking\n\n<reasoning>\n\n## Self-critique\n\n<critique>

    Each round attacks a DIFFERENT top hypothesis on a DIFFERENT angle, weaving
    in that idea's live Elo + review scores/verdict, so no two rounds read
    alike. Deterministic (seeded by goal + round).
    """
    lst = top or [{"title": "the current leader", "elo": None}]
    target = lst[(round_no - 1) % len(lst)]
    title = (target.get("title") or "an untitled idea").strip()
    angle = _CRITIQUE_ANGLES[(round_no - 1) % len(_CRITIQUE_ANGLES)]

    # Recompute the target's review the same way the scorecard does — keeps the
    # scores/verdict consistent with the rest of the session, deterministically.
    rv = make_review(goal, title, "full")
    sc = rv["scores"]
    low_dim = min(_REVIEW_DIMS, key=lambda d: sc[d])
    score_line = ", ".join(f"{d} {sc[d]:.2f}" for d in _REVIEW_DIMS)

    opener = _CRITIQUE_OPENERS[(round_no - 1) % len(_CRITIQUE_OPENERS)]
    closer = _CRITIQUE_CLOSERS[(round_no - 1) % len(_CRITIQUE_CLOSERS)]

    if round_no > 1:
        prev = lst[(round_no - 2) % len(lst)]
        prev_angle = _CRITIQUE_ANGLES[(round_no - 2) % len(_CRITIQUE_ANGLES)]
        prev_title = (prev.get("title") or "an untitled idea").strip()
        prior_ref = (
            f"Round {round_no - 1} probed the {prev_angle['name']} in "
            f"**{prev_title}**; this round I turn to the {angle['name']} in "
            f"**{title}**."
        )
    else:
        prior_ref = (
            f"This is the first critique pass, so I start by attacking the "
            f"current leader's {angle['name']}."
        )

    probe_lines = "\n".join(f"{i + 1}. {p}" for i, p in enumerate(angle["probes"]))
    thinking = (
        f"Round {round_no}. {prior_ref}\n\n"
        f"I re-read **{title}** ({_elo_txt(target.get('elo'))}) — its last review "
        f"landed at {score_line}, verdict *{rv['verdict']}*. The softest mark is "
        f"**{low_dim}** ({sc[low_dim]:.2f}), and that is exactly where a "
        f"{angle['name']} problem would bite.\n\n"
        f"{probe_lines}"
    )
    critique = (
        f"{opener} Looking hard at **{title}**, I am not convinced. The weak axis "
        f"this round is **{angle['name']}**: {angle['body']}.\n\n"
        f"Its {low_dim} score ({sc[low_dim]:.2f}) is the softest on its "
        f"scorecard, so {angle['threat']}. If that holds, the verdict of "
        f"*{rv['verdict']}* is generous and the {_elo_txt(target.get('elo'))} gap "
        f"to the field is doing more work than the evidence supports.\n\n"
        f"{closer}"
    )
    return f"## Thinking\n\n{thinking}\n\n## Self-critique\n\n{critique}"


# --------------------------------------------------------------------------- #
# Fabricated stress-test stage (shared contract with sim/content.ts)
# --------------------------------------------------------------------------- #

# Each probe pairs the named check that drove it with the concrete finding, so
# the verdict driver, the "what I attacked" line, and the found-evidence bullet
# all stay self-consistent.
_STRESS_PROBES = [
    {"check": "adversarial search",
     "attack": "went looking for the one published result that would sink it and "
               "found an adjacent study whose effect reversed once a stricter "
               "control was added",
     "found": "an adjacent result reversed once a stricter control was added"},
    {"check": "mechanism re-derivation",
     "attack": "re-derived the mechanism from scratch and found one causal step "
               "is assumed rather than demonstrated",
     "found": "one causal step is assumed, not demonstrated"},
    {"check": "dose-window probe",
     "attack": "probed the dose/intensity window and found the active range is "
               "narrower than the summary implies",
     "found": "the active dose window is narrower than the summary implies"},
    {"check": "readout audit",
     "attack": "checked whether the primary readout is the phenomenon itself or "
               "a proxy that can move for unrelated reasons",
     "found": "the primary readout may track a proxy, not the mechanism"},
]
# The three scannable verdict tokens (the chat + ranking key off these exact
# strings). "with fixes" is repeated so it's the common outcome.
_STRESS_VERDICT_TOKENS = [
    "**Verdict: PASS**",
    "**Verdict: PASS (with fixes)**",
    "**Verdict: PASS (with fixes)**",
    "**Verdict: FAIL**",
]


def _stress_verdict_token(goal: str, hyp_id: str) -> str:
    """Verdict token for a tested hyp — seeded on hyp id only (not round) so the
    stress report and the stress ranking always show the SAME token."""
    return _rng(f"{goal}|stressverdict|{hyp_id}").choice(_STRESS_VERDICT_TOKENS)


def _claim_gist(summary: str, fallback: str) -> str:
    """First sentence (<=160 chars) of a summary — the idea's actual claim."""
    s = (summary or "").strip()
    if not s:
        return fallback
    first = re.split(r"(?<=[.!?])\s", s)[0].strip()
    if len(first) > 160:
        first = first[:157] + "…"
    return first or fallback


_STRESS_FIXES = [
    "restricts the claim to the regime the pilot can actually defend and adds the "
    "control the stress test showed was load-bearing",
    "swaps the weakest citation for a direct falsification step and pre-registers "
    "the effect-size threshold before any scale-up",
    "narrows the dose/intensity window to where the effect clears noise and adds "
    "the orthogonal readout the original lacked",
]
_STRESS_FOUND = [
    "a key citation backed a weaker effect than claimed",
    "the effect shrank under a stricter control",
    "one causal step was assumed, not shown",
    "the readout risked tracking a proxy, not the mechanism",
]
_STRESS_APPLIED = [
    "narrowed the claim and added the missing control",
    "pre-registered the effect threshold and a direct falsification",
    "restricted the dose window to where the effect clears noise",
    "added an orthogonal readout to pin the mechanism",
]


def make_stress_report(goal: str, hyp: dict, round_info: dict) -> str:
    """Fabricated meta-review stress test for one top hypothesis.

    Shared contract (webapp/simulator.py + sim/content.ts makeStressReport):
    returns markdown ``## Thinking\\n\\n<reasoning>\\n\\n## Stress test\\n\\n<report>``.
    The first line of the report is exactly one scannable ``**Verdict: …**``
    token; "What I attacked" names the idea's real claim; found-evidence
    references its own citations by title (or flags the citation gap when none).
    Deterministic (seeded by goal + hyp id + round); varies per hypothesis.
    """
    title = (hyp.get("title") or "an untitled idea").strip()
    round_no = round_info.get("round", 1)
    of = round_info.get("of", 3)
    r = _rng(f"{goal}|stress|{hyp.get('id')}|{round_no}")
    probe = r.choice(_STRESS_PROBES)
    cites = hyp.get("citations") or []
    n_cites = len(cites)
    gist = _claim_gist(hyp.get("summary"), title)
    haircut = r.randint(20, 55)   # effect-size haircut under the stricter control
    n_units = r.choice([6, 8, 12])
    weeks = r.choice([2, 3, 4])
    effect = r.randint(15, 40)

    token = _stress_verdict_token(goal, hyp.get("id"))
    if "PASS (with fixes)" in token:
        driver = (f"the {probe['check']} exposed a real but bounded gap that the "
                  f"hardened revision below closes")
    elif "FAIL" in token:
        driver = (f"the {probe['check']} surfaced a gap the current claim cannot "
                  f"absorb without narrowing first")
    else:
        driver = "no disconfirming result held up and the load-bearing citations checked out"

    # Pre-fix review scores → plausible post-fix improvements (hardening lifts
    # correctness/testability/feasibility; novelty is unchanged by a fix).
    sc = make_review(goal, title, "full")["scores"]
    after = {
        "novelty": sc["novelty"],
        "correctness": min(0.97, round(sc["correctness"] + r.uniform(0.06, 0.14), 2)),
        "testability": min(0.97, round(sc["testability"] + r.uniform(0.02, 0.08), 2)),
        "feasibility": min(0.97, round(sc["feasibility"] + r.uniform(0.06, 0.14), 2)),
    }
    score_row = " · ".join(f"{d} {sc[d]:.2f} → {after[d]:.2f}" for d in _REVIEW_DIMS)

    cite_titles = list(dict.fromkeys(
        (c.get("title") or "untitled source").strip() for c in cites))
    if cite_titles:
        citation_line = "\n".join(
            f"- *{t}* — on re-reading, it backs a ~{haircut}% smaller effect than "
            f"the summary implies once a stricter control is added."
            for t in cite_titles[:2]
        )
    else:
        citation_line = (
            "- No sources were attached — flagging the citation gap as a finding: "
            "the claim currently rests on uncited reasoning."
        )

    thinking = (
        f"Stress round {round_no}/{of}. I am trying to *break* **{title}**, not "
        f"defend it.\n\n"
        f"Its core claim: “{gist}”. That lever is what I have to falsify.\n\n"
        f"1. Adversarial search: what published result, if it exists, would kill "
        f"this specific claim?\n"
        f"2. Citation audit: "
        + (f"re-open each of the {n_cites} supporting reference(s) and ask whether "
           f"it shows *this* effect or an adjacent one"
           if n_cites else
           "there are no attached sources, so the absence of evidence is itself "
           "the first finding")
        + ".\n"
        "3. Feasibility math: put rough numbers on the lever to see if the claimed "
        "effect is plausible at a realistic dose/setting.\n"
        "4. Design the cheapest experiment that could falsify it at prototype "
        "scale — before anyone commits real resources."
    )
    report = (
        f"{token} — {driver}.\n\n"
        f"**What I attacked.** I targeted the idea's core claim — “{gist}” — and "
        f"{probe['attack']}.\n\n"
        f"**Found evidence.**\n{citation_line}\n\n"
        f"**Scores before → after fix.** {score_row}.\n\n"
        f"**Feasibility numbers.** At a realistic exposure the predicted effect is "
        f"~{effect}% of the outcome measure — above noise, but the margin is thin, "
        f"so any pilot must be powered for it.\n\n"
        f"**Prototype-scale pilot (run this BEFORE scaling).**\n"
        f"- *Model:* the smallest faithful test bed for “{title[:60]}”.\n"
        f"- *Intervention:* the hypothesis's own lever, a single dose/setting.\n"
        f"- *Readout:* the primary outcome measure plus one orthogonal check.\n"
        f"- *Scale:* n = {n_units} units over {weeks} weeks — a pilot, not a full "
        f"study.\n"
        f"- *Success criterion:* a ≥{effect}% shift vs a matched control, "
        f"pre-registered; anything less kills the scale-up."
    )
    return f"## Thinking\n\n{thinking}\n\n## Stress test\n\n{report}"


def make_stress_fix(hyp: dict) -> dict:
    """Title + summary for the stress-hardened fix child of a tested hypothesis.

    Shared contract with sim/content.ts makeStressFix. Deterministic (seeded by
    hyp id)."""
    title = (hyp.get("title") or "an untitled idea").strip()
    r = _rng(f"fix|{hyp.get('id')}")
    fix = r.choice(_STRESS_FIXES)
    return {
        "title": f"{title} — hardened",
        "summary": (
            f"A stress-hardened revision of “{title}” that {fix}. Same "
            f"core mechanism, but the failure mode the stress test surfaced is now "
            f"designed out before scaling."
        ),
    }


def make_stress_ranking(goal: str, ranked3: list[dict]) -> str:
    """Markdown ordered list of the stress-tested top-3 after re-ranking.

    Shared contract with sim/content.ts makeStressRanking. Each ``ranked3`` entry
    is ``{tested, fix, elo, parent_elo}`` where ``tested``/``fix`` are dicts with
    ``id`` + ``title`` and elos are the final ratings; ordered best-first by the
    caller. Deterministic per tested id."""
    lines = [
        "## Stress-test ranking (fixes applied)",
        "",
        "After stress-testing the top three and breeding a hardened revision of "
        "each, the re-ranked order — with the fix each test forced — is:",
        "",
    ]
    for i, e in enumerate(ranked3, 1):
        tested, fix = e["tested"], e["fix"]
        r = _rng(f"{goal}|stressrank|{tested.get('id')}")
        found = r.choice(_STRESS_FOUND)
        applied = r.choice(_STRESS_APPLIED)
        token = _stress_verdict_token(goal, tested.get("id"))
        lines.append(
            f"{i}. **{fix.get('title')}** (`{fix.get('id')}`, Elo "
            f"{round(e['elo'])}) — {token} on the parent `{tested.get('id')}` "
            f"(parent Elo {round(e['parent_elo'])}). *Test found:* {found}. "
            f"*Fix applied:* {applied}."
        )
    return "\n".join(lines)
