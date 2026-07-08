/** Plausible-content generators for the in-browser simulator.
 *
 * A faithful TypeScript port of webapp/content.py — produces realistic-looking
 * hypotheses / reviews / overviews from a goal string so a session is fully
 * explorable with no backend and no API key. The shapes match the engine's
 * `Hypothesis` / `Review` / `Citation` types.
 *
 * NOTE: this content is *simulated*, not real LLM output. The UI labels it as
 * such whenever the engine is driving a session (see lib/live.ts isSimulatedMode).
 */

import type { Rng } from "./rng";
import { makeRng } from "./rng";

export const STRATEGIES = [
  "literature", "debate", "combine", "simplify",
  "out_of_box", "feasibility", "assumption", "feedback_driven",
] as const;

/** Model label shown in transcripts/analytics — matches the Groq theme. */
export const SIM_MODEL = "llama-3.3-70b-versatile";

const MECHANISMS: ReadonlyArray<readonly [string, string]> = [
  ["Repurposing {drug} via {pathway} modulation",
   "{drug} is a clinically approved agent whose off-target inhibition of {pathway} may suppress the disease-driving program identified in the goal."],
  ["{pathway} blockade reverses the {phenotype} phenotype",
   "Sustained {pathway} signaling maintains {phenotype}; pharmacological blockade should collapse the feed-forward loop and restore homeostasis."],
  ["Synthetic-lethal targeting of {gene} in {context}",
   "Cells in {context} become dependent on {gene}; a selective inhibitor exploits this dependency while sparing normal tissue."],
  ["{microbe}-derived metabolites drive {phenotype}",
   "Host exposure to {microbe} metabolites rewires {pathway}, providing a tractable, diet-modifiable lever over {phenotype}."],
  ["Combination of {drug} and {pathway} inhibition is synergistic",
   "Each agent alone is sub-therapeutic, but co-inhibition closes a compensatory escape route, predicting a strong synergy index."],
  ["Epigenetic priming sensitizes {context} to {drug}",
   "Low-dose epigenetic priming reopens silenced loci, restoring {drug} sensitivity in otherwise refractory {context}."],
];

const DRUGS = ["Nanvuranlat", "KIRA6", "Leflunomide", "Binimetinib", "Pacritinib",
  "Cerivastatin", "Dimethyl fumarate", "Metformin", "Disulfiram",
  "Niclosamide", "Auranofin", "Itraconazole"];
const PATHWAYS = ["IRE1α–XBP1", "DHODH", "MEK/ERK", "JAK2/STAT5", "mevalonate",
  "NRF2–KEAP1", "Wnt/β-catenin", "mTORC1", "ferroptosis", "cGAS–STING"];
const GENES = ["WRN", "PRMT5", "MAT2A", "USP1", "POLQ", "WEE1", "ATR"];
const PHENOTYPES = ["chronic inflammation", "drug tolerance", "stemness",
  "immune evasion", "fibrotic remodeling", "metabolic rewiring"];
const MICROBES = ["Akkermansia muciniphila", "Faecalibacterium prausnitzii",
  "Bacteroides fragilis", "segmented filamentous bacteria"];
const CONTEXTS = ["AML blasts", "senescent fibroblasts", "exhausted CD8 T cells",
  "drug-tolerant persister cells", "the inflamed gut epithelium"];

export interface SimCitation {
  title: string;
  url: string;
  excerpt: string | null;
  doi: string | null;
  year: number | null;
}

export interface SimHypothesisContent {
  title: string;
  summary: string;
  full_text: string;
  citations: SimCitation[];
  strategy: string;
}

export interface SimReviewContent {
  kind: string;
  verdict: string;
  scores: { novelty: number; correctness: number; testability: number; feasibility: number };
  body: string;
}

function fmt(tpl: string, fill: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => fill[k] ?? `{${k}}`);
}

export function makeHypothesis(goal: string, idx: number, strategy: string): SimHypothesisContent {
  const r = makeRng(`${goal}|${idx}|${strategy}`);
  const [mechTitle, mechBody] = r.choice(MECHANISMS);
  const fill = {
    drug: r.choice(DRUGS),
    pathway: r.choice(PATHWAYS),
    gene: r.choice(GENES),
    phenotype: r.choice(PHENOTYPES),
    microbe: r.choice(MICROBES),
    context: r.choice(CONTEXTS),
  };
  const title = fmt(mechTitle, fill);
  const body = fmt(mechBody, fill);
  const summary =
    `${body} The hypothesis is directly testable in existing ${fill.context} models with a clear, quantitative readout.`;
  const full_text = `## Mechanism

${body}

We propose that **${fill.pathway}** acts as the central node linking the
upstream stimulus to **${fill.phenotype}** observed in ${fill.context}.

## Rationale

1. Genetic perturbation of ${fill.gene} phenocopies the proposed intervention.
2. ${fill.drug} is already approved, de-risking translation and toxicity.
3. The pathway is druggable with sub-micromolar tool compounds.

## Proposed experiment

- **Model:** ${fill.context} (primary + isogenic line).
- **Intervention:** titrate ${fill.drug} ± ${fill.pathway} inhibitor.
- **Primary readout:** reversal of ${fill.phenotype} signature (RNA-seq + functional assay).
- **Controls:** vehicle, isotype, and a pathway-dead mutant rescue.
- **Success criterion:** >50% reduction in the ${fill.phenotype} score at a
  clinically achievable exposure.

## Predicted outcome

A dose-dependent collapse of the ${fill.phenotype} program with an
EC50 within the approved therapeutic window of ${fill.drug}.
`;
  const citations: SimCitation[] = [];
  const nCit = r.randint(2, 4);
  const ctxWord = fill.context.split(" ")[0];
  for (let i = 0; i < nCit; i++) {
    const yr = r.randint(2018, 2025);
    citations.push({
      title: `${fill.pathway} regulates ${fill.phenotype} in ${ctxWord} models`,
      url: `https://doi.org/10.1038/s${r.randint(40000, 49999)}-0${yr - 2000}-${r.randint(1000, 9999)}-x`,
      excerpt: `...inhibition of ${fill.pathway} reduced ${fill.phenotype} markers by ${r.randint(40, 80)}%...`,
      doi: `10.1038/s${r.randint(40000, 49999)}`,
      year: yr,
    });
  }
  return { title, summary, full_text, citations, strategy };
}

export function makeReview(goal: string, hypTitle: string, kind: string): SimReviewContent {
  const r = makeRng(`${goal}|${hypTitle}|${kind}`);
  const verdict = r.choice(["neutral", "missing_piece", "already_explained", "other_more_likely"]);
  const scores = {
    novelty: round2(r.uniform(0.45, 0.95)),
    correctness: round2(r.uniform(0.5, 0.95)),
    testability: round2(r.uniform(0.55, 0.98)),
    feasibility: round2(r.uniform(0.4, 0.9)),
  };
  const body = `**Verdict:** ${verdict}

**Novelty (${scores.novelty}).** The mechanistic link is under-explored; a
handful of adjacent papers exist but none test this exact intervention.

**Correctness (${scores.correctness}).** Internally consistent. The proposed
causal chain is plausible given the cited evidence, though one upstream step
relies on an assumption flagged below.

**Testability (${scores.testability}).** Strong — the readout is quantitative
and the reagents are commercially available.

**Feasibility (${scores.feasibility}).** Achievable within a standard wet-lab
budget; the main risk is compound exposure in the relevant compartment.

**Key assumption checked:** that the approved agent reaches the target tissue at
an active concentration. Rated *${r.choice(["plausible", "uncertain"])}*.
`;
  return { kind, verdict, scores, body };
}

export interface OverviewProposal {
  title: string;
  summary: string;
  strategy: string;
  elo: number | null;
}

/** Detailed research-proposal report. Mirrors the structure of the real
 *  metareview_final.md prompt so demo/sim output matches live output. */
export function makeOverview(goal: string, proposals: OverviewProposal[]): string {
  const top = proposals.slice(0, 5);
  const lead = top[0];

  const sections = top.map((p, i) => {
    const elo = p.elo != null ? Math.round(p.elo) : "—";
    return `### Proposal ${i + 1}. ${p.title}

**Tournament Elo:** ${elo} · **Generation strategy:** \`${p.strategy}\`

**The hypothesis.** ${p.summary}

**Why it's promising.** It survived repeated head-to-head debates against
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
clinically achievable exposure, or rescue by the mechanism-dead control.`;
  }).join("\n\n---\n\n");

  return `# Research proposal

**Research goal.** ${goal}

## Problem framing and significance

The goal above defines a question where a testable, mechanism-anchored answer
would materially change what a lab does next. Across a multi-agent tournament,
the system generated candidate hypotheses, critiqued them, and ranked them
head-to-head so that only ideas surviving repeated scrutiny rose to the top. The
proposals below are the survivors, ordered by tournament Elo.

## Executive summary

The tournament converged on ${top.length} strong candidate${top.length === 1 ? "" : "s"},
led by **${lead ? lead.title : "the top-ranked hypothesis"}**. The leading ideas
share a bias toward interventions that are testable with existing models and,
where possible, repurpose known agents to shorten the path from hypothesis to
evidence.

## The approach landscape

Independent generation strategies (literature-grounded, debate-driven,
combination, and out-of-box) were each given room to explore, then forced to
compete. Where several strategies nominated the same mechanism, that convergence
is treated as a robustness signal rather than redundancy.

## Ranked proposals

${sections}

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

*Generated by the Meta-review agent after Elo stabilization.*
`;
}

export interface SimPlan {
  objective: string;
  preferences: string[];
  constraints: string[];
  idea_attributes: string[];
  domain_hint: string;
  notes: string;
}

export function makePlan(goal: string): SimPlan {
  const r = makeRng(goal);
  return {
    objective: goal,
    preferences: r.sample(
      ["prioritize testable mechanisms", "favor drug repurposing", "emphasize novelty",
       "require quantitative readouts", "avoid CBRN-adjacent directions"], 3),
    constraints: r.sample(
      ["existing models only", "clinically approved agents preferred",
       "budget-bounded wet-lab", "no human-subjects work"], 2),
    idea_attributes: ["mechanistic", "testable", "novel", "feasible"],
    domain_hint: "biomedicine",
    notes: "Auto-parsed research plan.",
  };
}

/** Elo update — identical math to webapp/seed.py `_elo_update`. */
export function eloUpdate(ra: number, rb: number, winner: "a" | "b", k = 32): [number, number] {
  const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  const sa = winner === "a" ? 1.0 : 0.0;
  const ra2 = ra + k * (sa - ea);
  const rb2 = rb + k * ((1 - sa) - (1 - ea));
  return [round1(ra2), round1(rb2)];
}

function round1(n: number) { return Math.round(n * 10) / 10; }
function round2(n: number) { return Math.round(n * 100) / 100; }

export type { Rng };
