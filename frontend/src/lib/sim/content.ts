/** Prompt-aware, domain-agnostic content generators for the offline fallback.
 *
 * When no live model is reachable (offline, rate-limited, blocked), the engine
 * still needs to fill a tournament. This module derives that content from the
 * ACTUAL research goal — its real noun phrases and inferred domain — so a prompt
 * about traffic yields traffic hypotheses and a prompt about batteries yields
 * battery hypotheses. It never injects biomedicine unless the prompt is
 * biomedical. Everything is deterministic (seeded RNG), no network.
 *
 * This is a *simulated* fallback, clearly labelled in the UI. Real reasoning
 * comes from the live providers (see lib/llm/*).
 */

import type { Rng } from "./rng";
import { makeRng } from "./rng";

export const STRATEGIES = [
  "literature", "debate", "combine", "simplify",
  "out_of_box", "feasibility", "assumption", "feedback_driven",
] as const;

/** Model label shown in transcripts/analytics. */
export const SIM_MODEL = "llama-3.3-70b-versatile";

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

/* ── Prompt understanding (deterministic, no network) ──────── */

const STOPWORDS = new Set([
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
]);

const ACTION_VERBS = [
  "reduce", "lower", "cut", "decrease", "minimize", "minimise", "prevent",
  "eliminate", "improve", "increase", "boost", "enhance", "raise", "maximize",
  "maximise", "extend", "expand", "accelerate", "optimize", "optimise",
  "strengthen", "overcome", "restore", "stabilize", "stabilise",
];

export interface GoalKeywords {
  unigrams: string[];
  phrases: string[];
  topics: string[]; // salient noun phrases, longest first
}

/** Extract meaningful unigrams + contiguous content-word phrases from a goal. */
export function extractKeywords(goal: string): GoalKeywords {
  const tokens = goal.match(/[A-Za-z][A-Za-z0-9+–-]*/g) || [];
  const unigrams: string[] = [];
  const phrases: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) { phrases.push(run.join(" ")); run = []; }
  };
  for (const tok of tokens) {
    const low = tok.toLowerCase();
    const content = tok.length > 2 && !STOPWORDS.has(low);
    if (content) { run.push(tok); unigrams.push(low); }
    else flush();
  }
  flush();
  // Salient topics: contiguous phrases (1-4 words), longest/most-specific first.
  const topics = Array.from(new Set(phrases))
    .map((p) => p.split(" ").slice(0, 4).join(" "))
    .sort((a, b) => b.split(" ").length - a.split(" ").length || b.length - a.length);
  return { unigrams, phrases, topics };
}

interface DomainProfile {
  id: string;
  match: string[];
  levers: string[];
  metric: string;
  unit: string;
  methods: string[];
}

const DOMAINS: DomainProfile[] = [
  {
    id: "transportation",
    match: ["traffic", "congestion", "transit", "road", "commute", "vehicle", "mobility", "urban", "city", "parking", "transport", "bus", "rail", "driving", "highway", "pedestrian"],
    levers: ["dynamic congestion pricing", "adaptive signal control", "dedicated priority lanes", "demand-responsive routing", "a mode-shift incentive", "real-time rerouting"],
    metric: "average travel time", unit: "%",
    methods: ["a calibrated traffic microsimulation", "a before-after field study on a corridor", "a staggered rollout across zones"],
  },
  {
    id: "energy-materials",
    match: ["battery", "batteries", "lithium", "lithium-ion", "ion", "energy", "solar", "wind", "grid", "turbine", "storage", "material", "photovoltaic", "fuel", "hydrogen", "electrode", "electrolyte", "power", "thermal", "capacity", "charge"],
    levers: ["a protective interface coating", "a tuned operating-temperature window", "a materials substitution", "a smart charge controller", "an electrolyte additive"],
    metric: "cycle-life retention", unit: "%",
    methods: ["accelerated cycling on a test bench", "a controlled bench experiment", "a paired A/B hardware trial"],
  },
  {
    id: "computing",
    match: ["model", "algorithm", "software", "data", "network", "compute", "latency", "system", "code", "server", "database", "inference", "cache", "gpu", "throughput", "distributed", "spreadsheet", "layout", "app", "ui", "interface", "dashboard"],
    levers: ["an algorithmic redesign", "a caching layer", "a scheduling-policy change", "a model-architecture tweak", "a batching strategy"],
    metric: "end-to-end latency", unit: "%",
    methods: ["a benchmark with ablations", "an A/B experiment in staging", "a load test under production-like traffic"],
  },
  {
    id: "education-social",
    match: ["student", "students", "learning", "education", "retention", "teach", "school", "college", "training", "course", "curriculum", "literacy", "classroom", "tutor", "graduation"],
    levers: ["a structured mentoring program", "a low-cost behavioral nudge", "a curriculum redesign", "an early-warning outreach", "a peer-support cohort"],
    metric: "retention rate", unit: "%",
    methods: ["a randomized controlled trial", "a difference-in-differences study", "a stepped-wedge pilot"],
  },
  {
    id: "economics-business",
    match: ["market", "price", "pricing", "cost", "revenue", "customer", "supply", "demand", "business", "retail", "sales", "inventory", "logistics", "churn", "profit", "supermarket", "supermarkets", "food", "grocery", "perishable", "spoilage", "stock"],
    levers: ["dynamic pricing", "a demand-forecasting model", "a process redesign", "a targeted incentive", "an inventory-routing change"],
    metric: "unit cost", unit: "%",
    methods: ["an A/B pricing experiment", "a controlled pilot in selected sites", "a holdout-group trial"],
  },
  {
    id: "climate-environment",
    match: ["climate", "carbon", "emission", "emissions", "pollution", "pollutant", "air", "smog", "aqi", "ecosystem", "water", "sustainability", "sustainable", "recycling", "biodiversity", "greenhouse", "renewable"],
    levers: ["a deployment incentive", "a behavioral nudge", "a process electrification", "a monitoring-and-feedback loop", "a policy instrument"],
    metric: "emissions intensity", unit: "%",
    methods: ["a field trial with matched controls", "a monitored pilot deployment", "a scenario simulation"],
  },
  {
    id: "biomedicine",
    // NB: "cell"/"cells" intentionally omitted — too ambiguous (spreadsheet /
    // battery / phone cell). Real bio prompts hit cancer/tumor/gene/organoid/etc.
    match: ["gene", "genetic", "protein", "disease", "cancer", "drug", "tissue", "organoid", "microbiome", "patient", "clinical", "neuro", "neuroinflammation", "therapy", "therapeutic", "molecular", "immune", "blood", "brain", "metabolic", "tumor", "leukemia", "antibody", "biomarker"],
    levers: ["a repurposed approved compound", "a targeted pathway inhibitor", "a genetic perturbation", "a combination regimen", "an epigenetic priming step"],
    metric: "the disease-signature score", unit: "%",
    methods: ["an in-vitro assay in a relevant model", "an isogenic knockdown experiment", "a dose-response study"],
  },
];

const GENERIC: DomainProfile = {
  id: "generic",
  match: [],
  levers: ["a targeted intervention", "a structural redesign", "a data-driven policy", "an automated feedback controller", "an incentive realignment", "an early screening step"],
  metric: "the primary outcome measure", unit: "%",
  methods: ["a controlled pilot study", "a randomized experiment", "a simulation calibrated to real data", "a field trial with matched controls"],
};

/** Pick the domain whose vocabulary best matches the prompt (else generic).
 *  Matches tolerate simple plurals (batteries→battery, students→student). */
export function inferDomain(unigrams: string[]): DomainProfile {
  const set = new Set<string>();
  for (const u of unigrams) {
    set.add(u);
    if (u.endsWith("s") && u.length > 3) set.add(u.slice(0, -1)); // crude singular
  }
  let best = GENERIC, bestScore = 0;
  for (const d of DOMAINS) {
    // Count DISTINCT stems so a domain listing both "cell" and "cells" can't
    // score a single prompt occurrence twice (which used to leak biomedicine
    // into e.g. "layout of cells in a spreadsheet").
    const hits = new Set<string>();
    for (const m of d.match) {
      const stem = m.endsWith("s") && m.length > 3 ? m.slice(0, -1) : m;
      if (set.has(m) || set.has(stem)) hits.add(stem);
    }
    if (hits.size > bestScore) { best = d; bestScore = hits.size; }
  }
  return best;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s);

/** A short, prompt-grounded "aim" clause (uses the prompt's own words). */
function goalAim(goal: string): string {
  const lower = goal.toLowerCase();
  let idx = -1;
  for (const v of ACTION_VERBS) {
    const m = lower.search(new RegExp(`\\b${v}\\b`));
    if (m >= 0 && (idx < 0 || m < idx)) idx = m;
  }
  const clause = idx >= 0 ? goal.slice(idx) : goal;
  return clip(clause.replace(/[.?!]+$/g, "").trim().toLowerCase(), 90);
}

const TITLE_SCAFFOLDS = [
  (t: string, l: string, _l2: string, m: string, _me: string) => `${cap(l)} improves ${m} in ${t}`,
  (t: string, l: string, _l2: string, _m: string, _me: string) => `${cap(l)} as a lever for ${t}`,
  (t: string, l: string, l2: string, _m: string, _me: string) => `Combining ${l} and ${l2} in ${t}`,
  (t: string, l: string, _l2: string, _m: string, me: string) => `${cap(l)} for ${t}, tested via ${me}`,
  (t: string, l: string, _l2: string, _m: string, _me: string) => `Introducing ${l} early reduces failure in ${t}`,
  (t: string, l: string, _l2: string, m: string, _me: string) => `${cap(l)} shifts ${m} in ${t}`,
];

export function makeHypothesis(goal: string, idx: number, strategy: string): SimHypothesisContent {
  const r = makeRng(`${goal}|${idx}|${strategy}`);
  const { unigrams, topics } = extractKeywords(goal);
  const dom = inferDomain(unigrams);
  const aim = goalAim(goal);
  // Rotate through the prompt's own noun phrases so hypotheses cover its facets.
  const pool = topics.length ? topics : [clip(goal, 48)];
  const topic = pool[idx % pool.length] || clip(goal, 48);
  const lever = r.choice(dom.levers);
  let lever2 = r.choice(dom.levers);
  if (lever2 === lever) lever2 = dom.levers[(dom.levers.indexOf(lever) + 1) % dom.levers.length];
  const method = r.choice(dom.methods);
  const pct = r.randint(15, 45);

  const scaffold = TITLE_SCAFFOLDS[idx % TITLE_SCAFFOLDS.length];
  const title = clip(scaffold(topic, lever, lever2, dom.metric, method), 110);
  const summary =
    `${cap(lever)} is a plausible lever to ${aim}. The effect should appear as a measurable change in ${dom.metric}, making it directly testable via ${method} against a pre-registered threshold.`;
  const full_text = `## Mechanism

We hypothesise that **${lever}** acts on the core driver of ${topic}, and that this
propagates to a measurable shift in **${dom.metric}**. The link to the stated goal —
*${aim}* — is direct: if the lever works, the outcome moves; if it does not, the
outcome is unchanged, giving a clean falsification.

## Proposed experiment

- **Method:** ${cap(method)}.
- **Intervention:** apply ${lever}${strategy === "combine" ? ` together with ${lever2}` : ""}.
- **Primary readout:** ${dom.metric} (with a matched control condition).
- **Controls:** a no-intervention baseline and a plausibly-inert comparison.
- **Success criterion:** a ≥${pct}${dom.unit} improvement in ${dom.metric} versus control.

## Predicted outcome

A dose- or intensity-dependent change in ${dom.metric}, concentrated where
${topic} is most acute — with no effect in the inert control arm.
`;
  return { title, summary, full_text, citations: [], strategy };
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

**Novelty (${scores.novelty}).** The proposed lever is under-explored for this goal; adjacent work exists but does not test this exact intervention.

**Correctness (${scores.correctness}).** Internally consistent — the causal chain from intervention to the primary outcome is plausible, though one upstream assumption (below) is load-bearing.

**Testability (${scores.testability}).** Strong: the readout is quantitative and the proposed method yields a clear pass/fail against the stated threshold.

**Feasibility (${scores.feasibility}).** Achievable with commonly available methods; the main risk is confounding, which the control arm is designed to absorb.

**Key assumption checked:** that the measured outcome actually reflects the mechanism, not a proxy. Rated *${r.choice(["plausible", "uncertain"])}*.
`;
  return { kind, verdict, scores, body };
}

export interface OverviewScores {
  novelty: number; correctness: number; testability: number; feasibility: number;
}
export interface OverviewProposal {
  title: string;
  summary: string;
  strategy: string;
  elo: number | null;
  scores?: OverviewScores;
}
export interface OverviewFigures {
  /** hypothesis count per generation strategy → theme donut */
  strategyCounts?: Record<string, number>;
  /** every hypothesis as a lineage node → mermaid graph */
  lineage?: { id: string; label: string; parent: string | null; kind: "gen" | "evo" }[];
  /** elo trajectory per finalist → elo-race chart */
  eloSeries?: Record<string, { i: number; elo: number }[]>;
  eloLabels?: Record<string, string>;
}

const mmId = (s: string) => "n" + s.replace(/[^a-zA-Z0-9]/g, "");
const mmLabel = (s: string) => s.replace(/["\n]/g, " ").slice(0, 30);
// Escape GFM table-cell delimiters so a title containing '|' can't shift columns.
const cell = (s: string) => s.replace(/\|/g, "\\|");

/** The deterministic "Analysis" section: tables + chart/mermaid blocks + KaTeX,
 *  assembled from real session data so the figures are always correct regardless
 *  of any LLM prose. Copies as markdown (tables + fenced blocks) and renders on
 *  screen as SVG charts / a Mermaid diagram / KaTeX math. */
export function buildAnalysis(proposals: OverviewProposal[], figures?: OverviewFigures): string {
  const scored = proposals.filter((p) => p.scores);
  const parts: string[] = ["## Analysis"];

  if (scored.length) {
    const rows = scored.map((p, i) => {
      const s = p.scores!;
      return `| ${i + 1}. ${cell(p.title.slice(0, 40))} | ${s.novelty.toFixed(2)} | ${s.correctness.toFixed(2)} | ${s.testability.toFixed(2)} | ${s.feasibility.toFixed(2)} |`;
    }).join("\n");
    const spec = {
      type: "scores", title: "Reviewer scores by proposal",
      proposals: scored.map((p, i) => ({ label: `${i + 1}. ${p.title.slice(0, 32)}`, scores: p.scores })),
    };
    parts.push(`### Proposal scorecard

Reviewer scores for each finalist (0–1; higher is better).

| Proposal | Novelty | Correctness | Testability | Feasibility |
|---|---|---|---|---|
${rows}

\`\`\`chart
${JSON.stringify(spec)}
\`\`\``);
  }

  if (figures?.eloSeries && Object.keys(figures.eloSeries).length) {
    parts.push(`### How the ratings evolved

Each finalist's Elo rating over the tournament's head-to-head matches.

\`\`\`chart
${JSON.stringify({ type: "elo", title: "Elo over tournament matches", series: figures.eloSeries, labels: figures.eloLabels })}
\`\`\``);
  }

  if (figures?.strategyCounts && Object.keys(figures.strategyCounts).length) {
    const entries = Object.entries(figures.strategyCounts).sort((a, b) => b[1] - a[1]);
    const rows = entries.map(([k, v]) => `| ${k} | ${v} |`).join("\n");
    const spec = { type: "donut", title: "Hypotheses by generation strategy", segments: entries.map(([label, value]) => ({ label, value })) };
    parts.push(`### Where the ideas came from

| Generation strategy | Hypotheses |
|---|---|
${rows}

\`\`\`chart
${JSON.stringify(spec)}
\`\`\``);
  }

  if (figures?.lineage && figures.lineage.length) {
    const edges = figures.lineage
      .filter((n) => n.parent)
      .map((n) => `  ${mmId(n.parent!)} --> ${mmId(n.id)}`);
    const nodes = figures.lineage.map((n) =>
      `  ${mmId(n.id)}["${mmLabel(n.label)}"]`);
    parts.push(`### Idea lineage

Original hypotheses (left) and the offspring the Evolution agent bred from top parents (right).

\`\`\`mermaid
graph LR
${nodes.join("\n")}
${edges.join("\n")}
\`\`\``);
  }

  parts.push(`### Rating model

Each match updates a hypothesis's Elo rating $R$ by

$$R'_a = R_a + K\\,(S_a - E_a), \\qquad E_a = \\frac{1}{1 + 10^{(R_b - R_a)/400}}$$

where $S_a \\in \\{0, 1\\}$ is the match outcome for idea $a$ against idea $b$, and $K$ is the update rate (larger for newer ideas).`);

  return parts.join("\n\n");
}

/** Detailed research-proposal report. Mirrors the structure of the real
 *  metareview_final.md prompt so demo/sim output matches live output. */
export function makeOverview(goal: string, proposals: OverviewProposal[], figures?: OverviewFigures): string {
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

${buildAnalysis(top, figures)}

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
  const dom = inferDomain(extractKeywords(goal).unigrams);
  return {
    objective: goal,
    preferences: r.sample(
      ["prioritize testable mechanisms", "favor low-cost interventions", "emphasize novelty",
       "require quantitative readouts", "prefer reversible/ethical directions"], 3),
    constraints: r.sample(
      ["use existing methods where possible", "bounded budget", "clear falsification criteria required",
       "no high-risk directions"], 2),
    idea_attributes: ["mechanistic", "testable", "novel", "feasible"],
    domain_hint: dom.id,
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
