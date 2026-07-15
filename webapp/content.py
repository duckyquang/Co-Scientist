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

# --------------------------------------------------------------------------- #
# Prompt understanding (deterministic, no network) — mirrors sim/content.ts so a
# NON-biomedical goal (e.g. "a reasoning method better than chain-of-thought")
# yields on-topic hypotheses instead of drug/pathway mad-libs. Domain is inferred
# from the goal's own vocabulary; biomedicine is one domain among several.
# --------------------------------------------------------------------------- #

_STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "by",
    "at", "from", "into", "as", "is", "are", "be", "will", "can", "could", "would",
    "that", "this", "these", "those", "it", "its", "their", "our", "your", "we",
    "how", "what", "why", "which", "using", "use", "via", "based", "new", "novel",
    "testable", "strategies", "strategy", "mechanisms", "mechanism", "ways", "way",
    "approach", "approaches", "study", "research", "goal", "propose", "proposing",
    "find", "finding", "identify", "identifying", "generate", "generating",
    "discover", "explore", "investigate", "develop", "improve", "improving",
    "reduce", "reducing", "increase", "increasing", "extend", "extending",
    "overcome", "overcoming", "between", "linking", "across", "within",
}

_ACTION_VERBS = [
    "reduce", "lower", "cut", "decrease", "minimize", "minimise", "prevent",
    "eliminate", "improve", "increase", "boost", "enhance", "raise", "maximize",
    "maximise", "extend", "expand", "accelerate", "optimize", "optimise",
    "strengthen", "overcome", "restore", "stabilize", "stabilise",
]

_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9+–-]*")  # noqa: RUF001 — en dash matches hyphenated terms (mirrors sim/content.ts)


def _extract_keywords(goal: str) -> tuple[list[str], list[str]]:
    """(unigrams, topics): content unigrams + contiguous content-word phrases,
    longest/most-specific first. Mirrors sim/content.ts extractKeywords."""
    tokens = _TOKEN_RE.findall(goal)
    unigrams: list[str] = []
    phrases: list[str] = []
    run: list[str] = []

    def flush() -> None:
        if run:
            phrases.append(" ".join(run))
            run.clear()

    for tok in tokens:
        low = tok.lower()
        if len(tok) > 2 and low not in _STOPWORDS:
            run.append(tok)
            unigrams.append(low)
        else:
            flush()
    flush()
    topics = list(dict.fromkeys(" ".join(p.split()[:4]) for p in phrases))
    topics.sort(key=lambda p: (-len(p.split()), -len(p)))
    return unigrams, topics


_DOMAINS = [
    {
        "id": "transportation",
        "match": ["traffic", "congestion", "transit", "road", "commute", "vehicle",
                  "mobility", "urban", "city", "parking", "transport", "bus", "rail",
                  "driving", "highway", "pedestrian"],
        "levers": ["dynamic congestion pricing", "adaptive signal control",
                   "dedicated priority lanes", "demand-responsive routing",
                   "a mode-shift incentive", "real-time rerouting"],
        "metric": "average travel time", "unit": "%",
        "methods": ["a calibrated traffic microsimulation",
                    "a before-after field study on a corridor",
                    "a staggered rollout across zones"],
    },
    {
        "id": "energy-materials",
        "match": ["battery", "batteries", "lithium", "lithium-ion", "ion", "energy",
                  "solar", "wind", "grid", "turbine", "storage", "material",
                  "photovoltaic", "fuel", "hydrogen", "electrode", "electrolyte",
                  "power", "thermal", "capacity", "charge"],
        "levers": ["a protective interface coating", "a tuned operating-temperature window",
                   "a materials substitution", "a smart charge controller",
                   "an electrolyte additive"],
        "metric": "cycle-life retention", "unit": "%",
        "methods": ["accelerated cycling on a test bench", "a controlled bench experiment",
                    "a paired A/B hardware trial"],
    },
    {
        "id": "computing",
        "match": ["model", "algorithm", "software", "data", "network", "compute",
                  "latency", "system", "code", "server", "database", "inference",
                  "cache", "gpu", "throughput", "distributed", "spreadsheet",
                  "layout", "app", "ui", "interface", "dashboard", "reasoning",
                  "prompt", "prompting", "llm", "transformer", "agent"],
        "levers": ["an algorithmic redesign", "a caching layer",
                   "a scheduling-policy change", "a model-architecture tweak",
                   "a batching strategy"],
        "metric": "end-to-end latency", "unit": "%",
        "methods": ["a benchmark with ablations", "an A/B experiment in staging",
                    "a load test under production-like traffic"],
    },
    {
        "id": "education-social",
        "match": ["student", "students", "learning", "education", "retention",
                  "teach", "school", "college", "training", "course", "curriculum",
                  "literacy", "classroom", "tutor", "graduation"],
        "levers": ["a structured mentoring program", "a low-cost behavioral nudge",
                   "a curriculum redesign", "an early-warning outreach",
                   "a peer-support cohort"],
        "metric": "retention rate", "unit": "%",
        "methods": ["a randomized controlled trial", "a difference-in-differences study",
                    "a stepped-wedge pilot"],
    },
    {
        "id": "economics-business",
        "match": ["market", "price", "pricing", "cost", "revenue", "customer",
                  "supply", "demand", "business", "retail", "sales", "inventory",
                  "logistics", "churn", "profit", "supermarket", "supermarkets",
                  "food", "grocery", "perishable", "spoilage", "stock"],
        "levers": ["dynamic pricing", "a demand-forecasting model",
                   "a process redesign", "a targeted incentive",
                   "an inventory-routing change"],
        "metric": "unit cost", "unit": "%",
        "methods": ["an A/B pricing experiment", "a controlled pilot in selected sites",
                    "a holdout-group trial"],
    },
    {
        "id": "climate-environment",
        "match": ["climate", "carbon", "emission", "emissions", "pollution",
                  "pollutant", "air", "smog", "aqi", "ecosystem", "water",
                  "sustainability", "sustainable", "recycling", "biodiversity",
                  "greenhouse", "renewable"],
        "levers": ["a deployment incentive", "a behavioral nudge",
                   "a process electrification", "a monitoring-and-feedback loop",
                   "a policy instrument"],
        "metric": "emissions intensity", "unit": "%",
        "methods": ["a field trial with matched controls", "a monitored pilot deployment",
                    "a scenario simulation"],
    },
    {
        "id": "biomedicine",
        # NB: "cell"/"cells" intentionally omitted — too ambiguous (spreadsheet /
        # battery / phone cell). Real bio prompts hit cancer/tumor/gene/organoid/etc.
        "match": ["gene", "genetic", "protein", "disease", "cancer", "drug", "tissue",
                  "organoid", "microbiome", "patient", "clinical", "neuro",
                  "neuroinflammation", "therapy", "therapeutic", "molecular",
                  "immune", "blood", "brain", "metabolic", "tumor", "leukemia",
                  "antibody", "biomarker", "inflammation", "senescence", "fibrotic"],
        "levers": ["a repurposed approved compound", "a targeted pathway inhibitor",
                   "a genetic perturbation", "a combination regimen",
                   "an epigenetic priming step"],
        "metric": "the disease-signature score", "unit": "%",
        "methods": ["an in-vitro assay in a relevant model",
                    "an isogenic knockdown experiment", "a dose-response study"],
    },
]

_GENERIC = {
    "id": "generic", "match": [],
    "levers": ["a targeted intervention", "a structural redesign",
               "a data-driven policy", "an automated feedback controller",
               "an incentive realignment", "an early screening step"],
    "metric": "the primary outcome measure", "unit": "%",
    "methods": ["a controlled pilot study", "a randomized experiment",
                "a simulation calibrated to real data",
                "a field trial with matched controls"],
}


def _infer_domain(unigrams: list[str]) -> dict:
    """Pick the domain whose vocabulary best matches the prompt (else generic).
    Tolerates simple plurals; counts DISTINCT stems. Mirrors sim/content.ts."""
    stems = set()
    for u in unigrams:
        stems.add(u)
        if u.endswith("s") and len(u) > 3:
            stems.add(u[:-1])
    best, best_score = _GENERIC, 0
    for d in _DOMAINS:
        hits = set()
        for m in d["match"]:
            stem = m[:-1] if m.endswith("s") and len(m) > 3 else m
            if m in stems or stem in stems:
                hits.add(stem)
        if len(hits) > best_score:
            best, best_score = d, len(hits)
    return best


def _cap(s: str) -> str:
    return s[0].upper() + s[1:] if s else s


def _clip(s: str, n: int) -> str:
    if len(s) <= n:
        return s
    return re.sub(r"\s+\S*$", "", s[:n]) + "…"


def _goal_aim(goal: str) -> str:
    """A short, prompt-grounded 'aim' clause (uses the prompt's own words)."""
    lower = goal.lower()
    idx = -1
    for v in _ACTION_VERBS:
        m = re.search(rf"\b{v}\b", lower)
        if m and (idx < 0 or m.start() < idx):
            idx = m.start()
    clause = goal[idx:] if idx >= 0 else goal
    return _clip(re.sub(r"[.?!]+$", "", clause).strip().lower(), 90)


_TITLE_SCAFFOLDS = [
    lambda t, lv, lv2, m, me: f"{_cap(lv)} improves {m} in {t}",
    lambda t, lv, lv2, m, me: f"{_cap(lv)} as a lever for {t}",
    lambda t, lv, lv2, m, me: f"Combining {lv} and {lv2} in {t}",
    lambda t, lv, lv2, m, me: f"{_cap(lv)} for {t}, tested via {me}",
    lambda t, lv, lv2, m, me: f"Introducing {lv} early reduces failure in {t}",
    lambda t, lv, lv2, m, me: f"{_cap(lv)} shifts {m} in {t}",
]

# Curated pool of REAL, landmark papers. Every DOI was verified to resolve to a
# live publisher page (curl -sI -L → HTTP 200; transcript in the PR). The keyless
# simulator samples from these instead of minting random DOIs, so every demo
# citation links to a paper that actually exists. url is always
# "https://doi.org/" + doi, so the two never disagree. Kept in sync with
# REAL_PAPERS in frontend/src/lib/sim/content.ts.
_REAL_PAPERS = [
    {"title": "The Hallmarks of Cancer", "venue": "Cell", "year": 2000,
     "doi": "10.1016/S0092-8674(00)81683-9"},
    {"title": "Hallmarks of Cancer: The Next Generation", "venue": "Cell",
     "year": 2011, "doi": "10.1016/j.cell.2011.02.013"},
    {"title": "Highly accurate protein structure prediction with AlphaFold",
     "venue": "Nature", "year": 2021, "doi": "10.1038/s41586-021-03819-2"},
    {"title": "Improved protein structure prediction using potentials from deep "
              "learning", "venue": "Nature", "year": 2020,
     "doi": "10.1038/s41586-019-1923-7"},
    {"title": "Induction of Pluripotent Stem Cells from Mouse Embryonic and Adult "
              "Fibroblast Cultures by Defined Factors", "venue": "Cell",
     "year": 2006, "doi": "10.1016/j.cell.2006.07.024"},
    {"title": "Molecular Structure of Nucleic Acids: A Structure for Deoxyribose "
              "Nucleic Acid", "venue": "Nature", "year": 1953,
     "doi": "10.1038/171737a0"},
    {"title": "Initial sequencing and analysis of the human genome",
     "venue": "Nature", "year": 2001, "doi": "10.1038/35057062"},
    {"title": "Continuous cultures of fused cells secreting antibody of predefined "
              "specificity", "venue": "Nature", "year": 1975,
     "doi": "10.1038/256495a0"},
    {"title": "Potent and specific genetic interference by double-stranded RNA in "
              "Caenorhabditis elegans", "venue": "Nature", "year": 1998,
     "doi": "10.1038/35888"},
    {"title": "Establishment in culture of pluripotential cells from mouse embryos",
     "venue": "Nature", "year": 1981, "doi": "10.1038/292154a0"},
    {"title": "Basic local alignment search tool",
     "venue": "Journal of Molecular Biology", "year": 1990,
     "doi": "10.1016/S0022-2836(05)80360-2"},
    {"title": "Analysis of Relative Gene Expression Data Using Real-Time "
              "Quantitative PCR and the 2(-Delta Delta C(T)) Method",
     "venue": "Methods", "year": 2001, "doi": "10.1006/meth.2001.1262"},
    {"title": "Cleavage of Structural Proteins during the Assembly of the Head of "
              "Bacteriophage T4", "venue": "Nature", "year": 1970,
     "doi": "10.1038/227680a0"},
    {"title": "A rapid and sensitive method for the quantitation of microgram "
              "quantities of protein utilizing the principle of protein-dye "
              "binding", "venue": "Analytical Biochemistry", "year": 1976,
     "doi": "10.1016/0003-2697(76)90527-3"},
    {"title": "Immunity, Inflammation, and Cancer", "venue": "Cell", "year": 2010,
     "doi": "10.1016/j.cell.2010.01.025"},
    {"title": "The Human Microbiome Project", "venue": "Nature", "year": 2007,
     "doi": "10.1038/nature06244"},
    {"title": "Human gut microbes associated with obesity", "venue": "Nature",
     "year": 2006, "doi": "10.1038/4441022a"},
]


def _paper_citation(p: dict) -> dict:
    """Citation object for a curated real paper — url and doi always agree, and
    the excerpt references the paper generically (no fabricated statistic)."""
    return {
        "title": p["title"],
        "url": "https://doi.org/" + p["doi"],
        "excerpt": (
            f"{p['venue']} ({p['year']}) — cited as background support for this "
            "direction."
        ),
        "doi": p["doi"],
        "year": p["year"],
    }


def _rng(seed_text: str) -> random.Random:
    return random.Random(int(hashlib.sha256(seed_text.encode()).hexdigest()[:16], 16))


def make_hypothesis(goal: str, idx: int, strategy: str) -> dict:
    r = _rng(f"{goal}|{idx}|{strategy}")
    unigrams, topics = _extract_keywords(goal)
    dom = _infer_domain(unigrams)
    aim = _goal_aim(goal)
    # Rotate through the prompt's own noun phrases so hypotheses cover its facets.
    pool = topics or [_clip(goal, 48)]
    topic = pool[idx % len(pool)] or _clip(goal, 48)
    lever = r.choice(dom["levers"])
    lever2 = r.choice(dom["levers"])
    if lever2 == lever:
        lever2 = dom["levers"][(dom["levers"].index(lever) + 1) % len(dom["levers"])]
    method = r.choice(dom["methods"])
    pct = r.randint(15, 45)

    scaffold = _TITLE_SCAFFOLDS[idx % len(_TITLE_SCAFFOLDS)]
    # Deep mode can ask for many hypotheses but there are only a few scaffolds —
    # past the first rotation, tag a variant number so titles stay distinct.
    cycle = idx // len(_TITLE_SCAFFOLDS)
    base = _clip(scaffold(topic, lever, lever2, dom["metric"], method),
                 96 if cycle > 0 else 110)
    title = f"{base} — variant {cycle + 1}" if cycle > 0 else base
    summary = (
        f"{_cap(lever)} is a plausible lever to {aim}. The effect should appear as "
        f"a measurable change in {dom['metric']}, making it directly testable via "
        f"{method} against a pre-registered threshold."
    )
    combine_note = f" together with {lever2}" if strategy == "combine" else ""
    full_text = f"""## Mechanism

We hypothesise that **{lever}** acts on the core driver of {topic}, and that this
propagates to a measurable shift in **{dom['metric']}**. The link to the stated
goal — *{aim}* — is direct: if the lever works, the outcome moves; if it does
not, the outcome is unchanged, giving a clean falsification.

## Proposed experiment

- **Method:** {_cap(method)}.
- **Intervention:** apply {lever}{combine_note}.
- **Primary readout:** {dom['metric']} (with a matched control condition).
- **Controls:** a no-intervention baseline and a plausibly-inert comparison.
- **Success criterion:** a ≥{pct}{dom['unit']} improvement in {dom['metric']} versus control.

## Predicted outcome

A dose- or intensity-dependent change in {dom['metric']}, concentrated where
{topic} is most acute — with no effect in the inert control arm.
"""
    # Varied synthetic reasoning — three seeded picks referencing THIS idea's own
    # lever/topic/metric/method, so every hypothesis carries a distinct rationale.
    thinking = " ".join([
        r.choice([
            f"Starting from the goal — {aim} — I asked which single lever most "
            f"plausibly moves {dom['metric']}.",
            f"I worked backward from {dom['metric']}: what intervention on {topic} "
            f"shifts it most for the least cost?",
            f"The prompt points at {topic}; my instinct was to isolate one "
            f"mechanism rather than bundle several.",
            f"Before committing I weighed a few levers on {topic} and kept the one "
            f"with the cleanest read on {dom['metric']}.",
        ]),
        r.choice([
            f"{_cap(lever)} stood out because its effect on {dom['metric']} should "
            f"be direct, not mediated by a long causal chain.",
            f"I favoured {lever} since it acts close to the outcome, so a null "
            f"result is informative rather than ambiguous.",
            f"{_cap(lever)} is concrete enough to specify precisely and cheap "
            f"enough to falsify quickly.",
            f"The appeal of {lever} is that it fails loudly — if it does nothing "
            f"to {dom['metric']}, that rules it out cleanly.",
        ]),
        r.choice([
            f"Tested with {method}, a ≥{pct}{dom['unit']} move would be decisive; "
            f"anything less and I would drop it.",
            f"I would run {method} first — it gives a pass/fail on {dom['metric']} "
            f"before any larger commitment.",
            f"The plan is {method}, kept small and pre-registered so the "
            f"{pct}{dom['unit']} threshold actually means something.",
        ]),
    ])
    # Sample distinct REAL landmark papers (verified-resolving DOIs) so the demo's
    # citations always link to a paper that exists — no fabricated/random DOIs.
    citations = [_paper_citation(p) for p in r.sample(_REAL_PAPERS, r.randint(2, 4))]
    return {
        "title": title, "summary": summary, "full_text": full_text,
        "citations": citations, "strategy": strategy, "thinking": thinking,
    }


def make_review(goal: str, hyp_title: str, kind: str) -> dict:
    r = _rng(f"{goal}|{hyp_title}|{kind}")
    verdict = r.choice(
        ["neutral", "missing_piece", "already_explained", "other_more_likely"]
    )
    # Draw the scores FIRST so they stay stable regardless of the prose banks
    # below (the scorecard, self-critique and stress stages all read these).
    scores = {
        "novelty": round(r.uniform(0.45, 0.95), 2),
        "correctness": round(r.uniform(0.5, 0.95), 2),
        "testability": round(r.uniform(0.55, 0.98), 2),
        "feasibility": round(r.uniform(0.4, 0.9), 2),
    }
    # Seeded prose banks — the four dimension paragraphs vary per hyp/session so
    # no two reviews read alike, while the **Dimension (score).** labels stay fixed.
    nov = r.choice([
        "The proposed lever is under-explored for this goal; adjacent work exists "
        "but does not test this exact intervention.",
        "A genuinely fresh angle — the surrounding literature circles the idea "
        "without landing on this specific move.",
        "Not unprecedented, but the particular framing here has not been put to a "
        "direct test before.",
        "The novelty is in how the pieces are combined rather than the pieces "
        "themselves; the specific claim is under-tested.",
    ])
    cor = r.choice([
        "Internally consistent — the causal chain from intervention to the primary "
        "outcome is plausible, though one upstream assumption (below) is load-bearing.",
        "The logic holds together; the weakest link is a single upstream step, "
        "flagged below, that the design should pin down.",
        "No obvious contradiction, and the mechanism is stated crisply enough to "
        "check — one assumption still carries most of the weight.",
        "Reasoning is sound end-to-end, with the caveat that the effect depends on "
        "an intermediate step that is assumed rather than shown.",
    ])
    tes = r.choice([
        "Strong: the readout is quantitative and the proposed method yields a clear "
        "pass/fail against the stated threshold.",
        "Highly testable — a pre-registered threshold on a measurable readout turns "
        "this into a decisive experiment.",
        "The claim exposes itself to falsification: one clean measurement either "
        "clears the bar or sinks it.",
        "Good — the outcome is numeric and the comparison is controlled, so the "
        "result won't be open to interpretation.",
    ])
    fea = r.choice([
        "Achievable with commonly available methods; the main risk is confounding, "
        "which the control arm is designed to absorb.",
        "Within reach of a modest setup and timeline; the chief hazard is a confound "
        "the baseline arm has to neutralise.",
        "Practical to run soon and cheaply — the open question is whether the "
        "control fully isolates the effect.",
        "No exotic resources required; the sensitivity is to a confounder that the "
        "matched comparison is meant to rule out.",
    ])
    note = r.choice([
        "that the measured outcome actually reflects the mechanism, not a proxy",
        "that the intervention reaches the regime where it can act at all",
        "that the control arm removes the most likely alternative explanation",
        "that the effect size survives outside the tidy conditions of the pilot",
    ])
    body = f"""**Verdict:** {verdict}

**Novelty ({scores['novelty']}).** {nov}

**Correctness ({scores['correctness']}).** {cor}

**Testability ({scores['testability']}).** {tes}

**Feasibility ({scores['feasibility']}).** {fea}

**Key assumption checked:** {note}. Rated *{r.choice(['plausible', 'uncertain'])}*.
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


def _overview_refs(top: list[dict]) -> tuple[list[dict], list[list[str]]]:
    """Dedupe the proposals' OWN citation objects (curated real papers online, or
    OpenAlex) into a numbered reference list, and return a parallel per-proposal
    list of individual `[n]` marker strings so the caller can spread them across
    the sentences that lean on a source. Deduped by URL (fallback DOI) so a paper
    cited by two proposals shares one number — the overview, drawer and
    per-proposal donut all cite the SAME papers. Mirrors sim/content.ts."""
    refs: list[dict] = []
    markers: list[list[str]] = []
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
            if n not in ns:
                ns.append(n)
        markers.append([f"[{n}]" for n in sorted(ns)])
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
    # Seeded per SESSION (the proposal ids carry the session id) so two runs of
    # the same goal read differently while a re-render is stable. Top-level
    # sections draw from `r`; each proposal block gets its own stream.
    seed_tail = "|".join(p.get("id") or p.get("title", "") for p in top)
    r = _rng(f"{goal}|overview|{seed_tail}")

    sections = []
    for i, p in enumerate(top):
        elo = round(p["elo"]) if p.get("elo") is not None else "—"
        pr = _rng(f"{goal}|proposal|{p.get('id') or p.get('title')}")
        # Spread this proposal's own citation markers across the sentences that
        # lean on a source: the claim, why-it's-promising, and the experiment.
        cm = markers[i]
        at0 = f" {cm[0]}" if len(cm) > 0 else ""
        at1 = f" {cm[1]}" if len(cm) > 1 else ""
        exp_mk = f" {''.join(cm[2:])}" if len(cm) > 2 else ""
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
        why = pr.choice([
            "It survived repeated head-to-head debates against competing ideas, and "
            "reviewers scored it well on novelty and testability. The mechanism is "
            "specific enough to design a decisive experiment around.",
            "It kept winning matches on the strength of its argument rather than its "
            "framing, and the reviewers' marks back that up. Crucially, it is "
            "concrete enough that one experiment can settle it.",
            "Across the tournament it beat rivals that were vaguer or harder to "
            "test, and it carries a specific, falsifiable claim rather than a "
            "direction of travel.",
            "The idea earned its rank by holding up under scrutiny, not by "
            "out-arguing softer competitors — and its core claim is sharp enough to "
            "design a clean test around.",
        ])
        exp = pr.choice([
            "Set up the smallest faithful version of the system, apply the "
            "intervention across a short range, and read out the primary measure "
            "alongside one orthogonal check. Include an untouched baseline and a "
            "plausibly-inert comparison so a positive result is interpretable.",
            "Run a compact controlled trial: vary the lever over a few settings, "
            "measure the primary outcome plus a second independent signal, and hold "
            "a matched control so the effect can't be confused with drift.",
            "Start with a cheap decisive experiment — the intervention at one or two "
            "intensities, a quantitative readout, and both a do-nothing baseline and "
            "an inert-looking control to keep the result unambiguous.",
            "Build a minimal test bed, apply the intervention against a matched "
            "control, and track the primary measure together with an orthogonal one "
            "so a real effect and an artefact look different.",
        ])
        feas = pr.choice([
            "Achievable within a modest budget and a single cycle. The main risk is "
            "that the intervention never reaches the regime where it can act — worth "
            "a quick pilot to check that first.",
            "Cheap and quick to run. The chief hazard is a hidden confounder "
            "producing the same reading, which the control arm is there to absorb.",
            "No exotic resources needed and a short timeline. The open question is "
            "whether the effect survives outside the tidy conditions of the pilot.",
            "Practical to stand up soon. The real exposure is that the lever's "
            "active range is narrower than the summary implies, so the pilot should "
            "probe that window.",
        ])
        fal = pr.choice([
            "No measurable shift in the primary readout when the intervention is "
            "applied at a realistic setting, or the effect reproduced by the inert "
            "control.",
            "A flat primary measure across the intervention range, or a change that "
            "the matched control reproduces just as well.",
            "The orthogonal check failing to move with the primary one, or the whole "
            "effect vanishing once a stricter control is added.",
            "No dose- or intensity-dependent response where the phenomenon is most "
            "acute, or rescue by the plausibly-inert comparison arm.",
        ])
        sections.append(f"""### Proposal {i+1}. {p['title']}

**Tournament Elo:** {elo} · **Generation strategy:** `{p.get('strategy', 'literature')}`{radar}

**The hypothesis.** {p.get('summary', '').strip()}{at0}

**Why it's promising.**{at1} {why}

**Proposed first experiment.** {exp}{exp_mk}

**Feasibility and risks.** {feas}

**What would falsify it.** {fal}{tail}""")
    body = "\n\n---\n\n".join(sections)

    # Content figures woven into the relevant upper sections (empty strings when
    # a figure has no data). A slim rating-model note trails under "## Analysis".
    figs = _figure_set(goal, top, proposals)
    donut = f"\n\n{figs['donut']}" if figs["donut"] else ""
    scores = f"{figs['scores']}\n\n" if figs["scores"] else ""
    lineage = f"\n\n{figs['lineage']}" if figs["lineage"] else ""

    framing = r.choice([
        "The goal above defines a question where a testable, mechanism-anchored "
        "answer would materially change what happens next. Across a multi-agent "
        "tournament, the system generated candidate hypotheses, critiqued them, and "
        "ranked them head-to-head so that only ideas surviving repeated scrutiny "
        "rose to the top. The proposals below are the survivors, ordered by "
        "tournament Elo.",
        "Answering the goal well means turning it into something a team can "
        "actually test. The system spread the question across competing agents, let "
        "them argue and re-rank, and kept only the ideas that held up under "
        "pressure. What follows is that shortlist, ordered by tournament Elo.",
        "The question above rewards a concrete, falsifiable answer over a "
        "plausible-sounding one. To find it, the system generated many candidate "
        "directions, pitted them against each other, and let repeated critique thin "
        "the field. The proposals below are what remained, ranked by Elo.",
        "A useful answer here is one a lab can act on, not just agree with. The "
        "tournament produced candidate hypotheses, stress-tested them against "
        "rivals, and promoted the ones that kept winning on substance. Those "
        "survivors are listed below in Elo order.",
    ])
    exec_summary = r.choice([
        f"The tournament converged on {len(top)} strong "
        f"candidate{'' if len(top) == 1 else 's'}, led by **{lead_title}**. The "
        "leading ideas share a bias toward interventions that are testable with "
        "what's already on hand and, where possible, reuse known levers to shorten "
        "the path from hypothesis to evidence.",
        f"{len(top)} candidate{'' if len(top) == 1 else 's'} rose above the rest, "
        f"with **{lead_title}** in front. What unites the leaders is a preference "
        "for cheap, decisive tests over ambitious ones, and for building on "
        "established levers rather than inventing from scratch.",
        f"After the dust settled, {len(top)} idea{'' if len(top) == 1 else 's'} "
        f"stood out — **{lead_title}** most of all. The front-runners are linked "
        "less by topic than by temperament: each is specified tightly enough to "
        "falsify quickly and leans on existing methods to move fast.",
        f"The field narrowed to {len(top)} serious "
        f"contender{'' if len(top) == 1 else 's'}, headed by **{lead_title}**. The "
        "common thread among them is pragmatism — testable with current tools, and "
        "framed so a null result is as informative as a hit.",
    ])
    landscape = r.choice([
        "Independent generation strategies (literature-grounded, debate-driven, "
        "combination, and out-of-box) were each given room to explore, then forced "
        "to compete. Where several strategies nominated the same mechanism, that "
        "convergence is treated as a robustness signal rather than redundancy.",
        "Several strategies ran in parallel — grounded in prior work, argued out in "
        "debate, recombined, and deliberately unconventional — before being made to "
        "fight for rank. When different strategies landed on the same idea, we read "
        "that agreement as evidence, not repetition.",
        "The candidates came from distinct angles: some read off the existing "
        "literature, some emerged from debate, some from recombining earlier ideas, "
        "and some from deliberately breaking the frame. Overlap between independent "
        "angles is counted in an idea's favour rather than pruned as duplication.",
        "Generation was intentionally diverse — literature-anchored, adversarial, "
        "combinatorial, and contrarian lines all contributed — and then the "
        "tournament forced a reckoning. A mechanism that surfaced from more than one "
        "line is treated as corroborated, not redundant.",
    ])
    comparative = r.choice([
        "The top proposals are not interchangeable: some converge on a shared "
        "mechanism (mutually reinforcing evidence), while others are genuinely "
        "orthogonal bets worth running in parallel to hedge mechanism risk. Prefer "
        "starting with the highest-Elo idea that also has the cheapest decisive "
        "experiment.",
        "These leaders are not variations on one theme — a few reinforce each other "
        "by pointing at the same mechanism, while others are independent wagers best "
        "run side by side. The pragmatic opening move is the top-ranked idea whose "
        "decisive experiment is also the cheapest.",
        "Read together, the proposals split into overlapping bets and genuinely "
        "separate ones; the overlaps strengthen each other, the separations hedge "
        "against being wrong about the mechanism. Sequence them by starting where "
        "high rank meets a low-cost decisive test.",
        "The shortlist mixes mutually supporting ideas with orthogonal ones, and "
        "both kinds earn their place — one for corroboration, the other for "
        "insurance. Begin with whichever high-Elo idea can be settled most cheaply.",
    ])
    rec1 = r.choice([
        "Run the single cheapest decisive experiment for the top proposal first.",
        "Start with the top proposal's cheapest experiment that can actually settle it.",
        "Spend the first dollar on the most decisive, lowest-cost test of the leader.",
    ])
    rec2 = r.choice([
        "If it clears, add the orthogonal runner-up to hedge mechanism risk.",
        "If that holds up, bring in the most independent runner-up as a hedge.",
        "Assuming a positive read, run the orthogonal runner-up next to cover the "
        "mechanism risk.",
    ])
    rec3 = r.choice([
        "Pre-register every falsification threshold before any hands-on work begins.",
        "Fix and record each pass/fail threshold up front, before collecting data.",
        "Lock in the falsification criteria in advance so a near-miss can't be "
        "argued away.",
    ])
    open_q = r.choice([
        "Where the evidence was thin, reviewer confidence is lower and a domain "
        "expert is most likely to disagree — treat those proposals as exploratory. "
        "The tournament optimizes for debate-survivability, not ground truth, so a "
        "high Elo is a strong prior, not a proof.",
        "The proposals resting on the least support are exactly where an expert "
        "would push back hardest; hold them loosely. Remember the ranking rewards "
        "ideas that survive argument, which is correlated with being right but is "
        "not the same thing.",
        "Confidence should track the underlying support, which is uneven — the "
        "thinner cases are best read as leads rather than conclusions. A high Elo "
        "says an idea withstood scrutiny, not that it is true.",
        "Some of these stand on firmer ground than others, and the shakier ones "
        "deserve a skeptic's eye before any commitment. The tournament measures how "
        "well an idea defends itself, so treat rank as a prior to update, not a "
        "verdict.",
    ])

    return f"""# Research proposal

**Research goal.** {goal}

## Problem framing and significance

{framing}

## Executive summary

{exec_summary}

## The approach landscape

{landscape}{donut}

## Ranked proposals

{scores}{body}

## Comparative assessment

{comparative}{lineage}

## Recommended path and sequencing

1. {rec1}
2. {rec2}
3. {rec3}

## Open questions and limitations

{open_q}

## Analysis

{_RATING_MODEL_NOTE}

## References

{references}

*Generated by the Meta-review agent after Elo stabilization.*
"""


def make_plan(goal: str) -> dict:
    r = _rng(goal)
    dom = _infer_domain(_extract_keywords(goal)[0])
    return {
        "objective": goal,
        "preferences": r.sample(
            ["prioritize testable mechanisms", "favor low-cost interventions",
             "emphasize novelty", "require quantitative readouts",
             "prefer reversible/ethical directions"], 3),
        "constraints": r.sample(
            ["use existing methods where possible", "bounded budget",
             "clear falsification criteria required", "no high-risk directions"], 2),
        "idea_attributes": ["mechanistic", "testable", "novel", "feasible"],
        "domain_hint": dom["id"],
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
    # Seeded stitching banks so the connective sentences vary by round + target,
    # instead of being identical every session. The angle/opener/closer already
    # rotate; this varies the prose that links them.
    cr = _rng(f"{goal}|selfcritique|{round_no}|{title}")
    low_str = f"{sc[low_dim]:.2f}"
    e_txt = _elo_txt(target.get("elo"))

    if round_no > 1:
        prev = lst[(round_no - 2) % len(lst)]
        prev_angle = _CRITIQUE_ANGLES[(round_no - 2) % len(_CRITIQUE_ANGLES)]
        prev_title = (prev.get("title") or "an untitled idea").strip()
        prior_ref = cr.choice([
            f"Round {round_no - 1} probed the {prev_angle['name']} in "
            f"**{prev_title}**; this round I turn to the {angle['name']} in "
            f"**{title}**.",
            f"Last round it was the {prev_angle['name']} in **{prev_title}**. Now I "
            f"switch targets to **{title}** and press on its {angle['name']}.",
            f"Having leaned on the {prev_angle['name']} of **{prev_title}** in round "
            f"{round_no - 1}, I move to a different idea and a different axis: the "
            f"{angle['name']} in **{title}**.",
        ])
    else:
        prior_ref = cr.choice([
            f"This is the first critique pass, so I start by attacking the current "
            f"leader's {angle['name']}.",
            f"First pass — I open on the leader and go straight at its "
            f"{angle['name']}.",
            f"Nothing to compare against yet, so I begin where the leader looks "
            f"softest: its {angle['name']}.",
        ])

    reread = cr.choice([
        f"I re-read **{title}** ({e_txt}) — its last review landed at {score_line}, "
        f"verdict *{rv['verdict']}*. The softest mark is **{low_dim}** ({low_str}), "
        f"and that is exactly where a {angle['name']} problem would bite.",
        f"Back to **{title}** ({e_txt}). The scorecard reads {score_line}, verdict "
        f"*{rv['verdict']}*; **{low_dim}** ({low_str}) is the weakest line, and a "
        f"{angle['name']} flaw would land right there.",
        f"Looking again at **{title}** ({e_txt}): review scores {score_line}, "
        f"verdict *{rv['verdict']}*. Its low mark is **{low_dim}** ({low_str}) — the "
        f"same place a {angle['name']} problem would do the most damage.",
    ])
    probe_lines = "\n".join(f"{i + 1}. {p}" for i, p in enumerate(angle["probes"]))
    thinking = f"Round {round_no}. {prior_ref}\n\n{reread}\n\n{probe_lines}"

    doubt = cr.choice([
        f"Looking hard at **{title}**, I am not convinced. The weak axis this round "
        f"is **{angle['name']}**: {angle['body']}.",
        f"I read **{title}** against the grain and it does not fully hold up. The "
        f"exposed axis is **{angle['name']}** — {angle['body']}.",
        f"Pressing on **{title}**, my doubt sharpens rather than fades. It turns on "
        f"**{angle['name']}**: {angle['body']}.",
    ])
    stakes = cr.choice([
        f"Its {low_dim} score ({low_str}) is the softest on its scorecard, so "
        f"{angle['threat']}. If that holds, the verdict of *{rv['verdict']}* is "
        f"generous and the {e_txt} gap to the field is doing more work than the "
        f"evidence supports.",
        f"With {low_dim} already the lowest mark ({low_str}), {angle['threat']}. "
        f"Should that be right, *{rv['verdict']}* flatters it, and its {e_txt} lead "
        f"is resting on argument more than proof.",
        f"The {low_str} on {low_dim} is where it is thinnest, which means "
        f"{angle['threat']}. If so, calling it *{rv['verdict']}* is charitable and "
        f"the {e_txt} margin overstates the case.",
    ])
    critique = f"{opener} {doubt}\n\n{stakes}\n\n{closer}"
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

    # Seeded prose banks (drawn AFTER the numeric picks so those stay stable).
    # Only the connective sentences vary; the report's bold section frame is fixed.
    cite_tail = r.choice([
        f"on re-reading, it backs a ~{haircut}% smaller effect than the summary "
        f"implies once a stricter control is added",
        f"read closely, it supports an effect about {haircut}% weaker than the "
        f"claim, and only before the stricter control",
        f"the actual result is ~{haircut}% below what the summary leans on it for "
        f"once you tighten the control",
    ])
    cite_titles = list(dict.fromkeys(
        (c.get("title") or "untitled source").strip() for c in cites))
    if cite_titles:
        citation_line = "\n".join(
            f"- *{t}* — {cite_tail}." for t in cite_titles[:2]
        )
    else:
        citation_line = (
            "- No sources were attached — flagging the citation gap as a finding: "
            "the claim currently rests on uncited reasoning."
        )
    break_line = r.choice([
        f"Stress round {round_no}/{of}. I am trying to *break* **{title}**, not "
        f"defend it.",
        f"Stress round {round_no}/{of}. My job here is to falsify **{title}**, not "
        f"to make its case.",
        f"Stress round {round_no}/{of}. I approach **{title}** as an adversary "
        f"looking for the crack, not an advocate.",
    ])
    claim_line = r.choice([
        f"Its core claim: “{gist}”. That lever is what I have to falsify.",
        f"The claim under fire: “{gist}”. If it is wrong, that is where it breaks.",
        f"What it asserts: “{gist}”. This is the load-bearing lever I need to knock "
        f"over.",
    ])
    attack_lead = r.choice([
        f"**What I attacked.** I targeted the idea's core claim — “{gist}” — and "
        f"{probe['attack']}.",
        f"**What I attacked.** Going straight at the central claim — “{gist}” — I "
        f"{probe['attack']}.",
        f"**What I attacked.** I took aim at the load-bearing claim — “{gist}” — and "
        f"{probe['attack']}.",
    ])
    feas_line = r.choice([
        f"**Feasibility numbers.** At a realistic exposure the predicted effect is "
        f"~{effect}% of the outcome measure — above noise, but the margin is thin, "
        f"so any pilot must be powered for it.",
        f"**Feasibility numbers.** Under realistic conditions the effect works out "
        f"to ~{effect}% of the outcome — it clears noise, but only just, so a pilot "
        f"needs real statistical power.",
        f"**Feasibility numbers.** The back-of-envelope effect is ~{effect}% of the "
        f"measure at a plausible setting — detectable, yet close enough to noise "
        f"that an underpowered pilot would miss it.",
    ])

    thinking = (
        f"{break_line}\n\n"
        f"{claim_line}\n\n"
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
        f"{attack_lead}\n\n"
        f"**Found evidence.**\n{citation_line}\n\n"
        f"**Scores before → after fix.** {score_row}.\n\n"
        f"{feas_line}\n\n"
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
    thinking = " ".join([
        r.choice([
            f"The stress test on “{title}” found a real but bounded weakness, so I "
            f"kept the mechanism and redesigned around the failure mode.",
            f"Rather than abandon “{title}”, I isolated the one place the stress "
            f"test broke it and closed that gap specifically.",
            f"“{title}” survived scrutiny except at a single seam; this revision "
            f"targets exactly that seam and nothing else.",
        ]),
        r.choice([
            "The change is deliberately conservative — narrow the claim to what the "
            "evidence defends and add the control the test showed was load-bearing.",
            "I resisted broadening the idea; the fix only removes the failure the "
            "test exposed, so the comparison to the parent stays clean.",
            "Keeping the edit minimal means a re-rank measures the fix, not a "
            "wholesale rewrite.",
        ]),
    ])
    return {
        "title": f"{title} — hardened",
        "summary": (
            f"A stress-hardened revision of “{title}” that {fix}. Same "
            f"core mechanism, but the failure mode the stress test surfaced is now "
            f"designed out before scaling."
        ),
        "thinking": thinking,
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
