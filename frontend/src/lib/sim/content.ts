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

/* Rotating title/excerpt scaffolds so a hypothesis's 2–4 fabricated citations
 * read as distinct sources rather than one paper repeated. */
const CITE_SCAFFOLDS: ((l: string, m: string, t: string) => string)[] = [
  (l, m, t) => `${cap(l)} and its effect on ${m} in ${t}`,
  (l, _m, t) => `A systematic review of ${l} for ${t}`,
  (l, m, _t) => `Field evidence that ${l} shifts ${m}`,
  (l, m, t) => `${cap(t)}: measuring ${m} under ${l}`,
];

/** Fabricate 2–4 well-formed placeholder citations for a TEMPLATE hypothesis
 *  (deterministic — the caller's seeded rng). Like the rest of the simulated
 *  fallback these are clearly demo data, mirroring webapp/content.py's
 *  fabrications and overviewRefs below so the drawer's Citations section and
 *  the per-proposal cited-sources donut render in sim mode. Groq/BYOK-generated
 *  hypotheses must NOT get these — engine.ts keeps them at citations: []. */
function makeCitations(r: Rng, topic: string, lever: string, metric: string): SimCitation[] {
  const n = r.randint(2, 4);
  const out: SimCitation[] = [];
  for (let i = 0; i < n; i++) {
    const yr = r.randint(2018, 2025);
    const doi = `10.1038/s${r.randint(40000, 49999)}-${String(yr % 100).padStart(2, "0")}-${r.randint(1000, 9999)}-x`;
    out.push({
      title: CITE_SCAFFOLDS[i % CITE_SCAFFOLDS.length](lever, metric, topic),
      url: `https://doi.org/${doi}`,
      excerpt: `…${lever} shifted ${metric} by ${r.randint(15, 60)}% relative to matched controls…`,
      doi,
      year: yr,
    });
  }
  return out;
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
  // Deep mode asks for up to 50 hypotheses but there are only a handful of
  // scaffolds/topics/levers — past the first rotation, tag a variant number so
  // titles stay distinct instead of silently repeating.
  const cycle = Math.floor(idx / TITLE_SCAFFOLDS.length);
  const base = clip(scaffold(topic, lever, lever2, dom.metric, method), cycle > 0 ? 96 : 110);
  const title = cycle > 0 ? `${base} — variant ${cycle + 1}` : base;
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
  return { title, summary, full_text, citations: makeCitations(r, topic, lever, dom.metric), strategy };
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
  // Widened so the top-3 proposal blocks can carry per-proposal figures: a
  // mechanism pipeline (from fullText), a cited-sources donut (from citations),
  // and a per-id Elo sparkline (looked up in figures.eloSeries by id).
  id?: string;
  fullText?: string;
  citations?: SimCitation[];
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

/* ── Figure helpers ─────────────────────────────────────────────
 * Each returns a self-contained markdown figure body (table + ```chart, or a
 * ```mermaid graph) or null. `figureSet` numbers them in document order and
 * adds captions; makeOverview / the engine wrapper splice each into a section.
 * Assembled from real session data so the figures are always correct regardless
 * of any LLM prose; render on screen as SVG / Mermaid / KaTeX. */

const RATING_MODEL_NOTE = `### Rating model

Each match updates a hypothesis's Elo rating $R$ by

$$R'_a = R_a + K\\,(S_a - E_a), \\qquad E_a = \\frac{1}{1 + 10^{(R_b - R_a)/400}}$$

where $S_a \\in \\{0, 1\\}$ is the match outcome for idea $a$ against idea $b$, and $K$ is the update rate (larger for newer ideas). Each idea enters the tournament seeded between 1000 and 1800 by review quality, so ratings spread toward the 1000-2000 band as matches accumulate.`;

function scoresBody(proposals: OverviewProposal[]): string | null {
  const scored = proposals.filter((p) => p.scores);
  if (!scored.length) return null;
  const rows = scored.map((p, i) => {
    const s = p.scores!;
    return `| ${i + 1}. ${cell(p.title.slice(0, 40))} | ${s.novelty.toFixed(2)} | ${s.correctness.toFixed(2)} | ${s.testability.toFixed(2)} | ${s.feasibility.toFixed(2)} |`;
  }).join("\n");
  const spec = {
    type: "scores", title: "Reviewer scores by proposal",
    proposals: scored.map((p, i) => ({ label: `${i + 1}. ${p.title.slice(0, 32)}`, scores: p.scores })),
  };
  return `| Proposal | Novelty | Correctness | Testability | Feasibility |
|---|---|---|---|---|
${rows}

\`\`\`chart
${JSON.stringify(spec)}
\`\`\``;
}

function eloBody(figures?: OverviewFigures): string | null {
  if (!figures?.eloSeries || !Object.keys(figures.eloSeries).length) return null;
  return `\`\`\`chart
${JSON.stringify({ type: "elo", title: "Elo over tournament matches", series: figures.eloSeries, labels: figures.eloLabels })}
\`\`\``;
}

function donutBody(figures?: OverviewFigures): string | null {
  if (!figures?.strategyCounts || !Object.keys(figures.strategyCounts).length) return null;
  const entries = Object.entries(figures.strategyCounts).sort((a, b) => b[1] - a[1]);
  const rows = entries.map(([k, v]) => `| ${k} | ${v} |`).join("\n");
  const spec = { type: "donut", title: "Hypotheses by generation strategy", segments: entries.map(([label, value]) => ({ label, value })) };
  return `| Generation strategy | Hypotheses |
|---|---|
${rows}

\`\`\`chart
${JSON.stringify(spec)}
\`\`\``;
}

function lineageBody(figures?: OverviewFigures): string | null {
  if (!figures?.lineage || !figures.lineage.length) return null;
  const edges = figures.lineage
    .filter((n) => n.parent)
    .map((n) => `  ${mmId(n.parent!)} --> ${mmId(n.id)}`);
  const nodes = figures.lineage.map((n) => `  ${mmId(n.id)}["${mmLabel(n.label)}"]`);
  return `\`\`\`mermaid
graph LR
${nodes.join("\n")}
${edges.join("\n")}
\`\`\``;
}

export interface FigureSet {
  donut: string; scores: string; elo: string; lineage: string; ratingModel: string;
}

/** Numbered, captioned figure blocks for weaving into a proposal's sections.
 *  Empty string when a figure has no data. Numbered in document order. */
export function figureSet(proposals: OverviewProposal[], figures?: OverviewFigures): FigureSet {
  let n = 0;
  const cap = (body: string | null, text: string) =>
    body ? `${body}\n\n*Fig. ${++n} — ${text}*` : "";
  return {
    donut: cap(donutBody(figures), "share of the finalist hypotheses by generation strategy."),
    scores: cap(scoresBody(proposals), "reviewer scores across the four dimensions for each finalist."),
    elo: cap(eloBody(figures), "Elo trajectory of the finalists across tournament matches."),
    lineage: cap(lineageBody(figures), "idea lineage — offspring the Evolution agent bred from top parents."),
    ratingModel: RATING_MODEL_NOTE,
  };
}

/** Insert `block` right after the Nth (1-based) `## ` heading line in `md`.
 *  Unchanged if `block` is empty or fewer than N such headings exist. */
export function insertAfterHeading(md: string, n: number, block: string): string {
  if (!block) return md;
  const re = /^##\s+.+$/gm;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = re.exec(md)) !== null) {
    if (++count === n) {
      const i = m.index + m[0].length;
      return `${md.slice(0, i)}\n\n${block}${md.slice(i)}`;
    }
  }
  return md;
}

interface OverviewRef { n: number; title: string; year: number; url: string }

/** Fabricate one well-formed citation per proposal (deterministic, demo data).
 *  The sim's makeHypothesis carries no real sources, so — like the rest of the
 *  simulated content — these are clearly-labelled placeholders that let the demo
 *  show the References feature. Returns numbered refs + per-proposal `[n]`
 *  markers, deduped by URL. The real engine builds References from real data;
 *  the browser-LLM path passes null to referencesSection (honest, no sources). */
function overviewRefs(goal: string, top: OverviewProposal[]): { refs: OverviewRef[]; markers: string[] } {
  const refs: OverviewRef[] = [];
  const markers: string[] = [];
  const urlToN = new Map<string, number>();
  for (const p of top) {
    const r = makeRng(`ref|${goal}|${p.title}`);
    const yr = r.randint(2018, 2025);
    const doi = `10.1038/s${r.randint(40000, 49999)}-${String(yr % 100).padStart(2, "0")}-${r.randint(1000, 9999)}-x`;
    const url = `https://doi.org/${doi}`;
    let n = urlToN.get(url);
    if (n === undefined) {
      n = refs.length + 1;
      urlToN.set(url, n);
      refs.push({ n, title: `Evidence bearing on: ${p.title}`, year: yr, url });
    }
    markers.push(`[${n}]`);
  }
  return { refs, markers };
}

/** A `## References` section built from citation objects. Empty/omitted refs →
 *  an honest note rather than fabricated credibility (used by the browser-LLM
 *  path, which retrieves no literature). */
export function referencesSection(refs: { n: number; title: string; year: number | null; url: string }[] | null): string {
  if (!refs || !refs.length) {
    return "## References\n\nNo external sources were retrieved in this mode; the claims above are model-generated and unverified.";
  }
  return ["## References", "", ...refs.map((c) => `[${c.n}] ${c.title} (${c.year ?? "n.d."}). ${c.url}`.trim())].join("\n");
}

/* ── Per-proposal (unnumbered) figure helpers ───────────────────
 * These sit at the END of each top-3 `### Proposal N` block, carrying a
 * chart/mermaid title instead of a Fig.N caption so the document-level Fig.N
 * numbering (figureSet) stays monotonic. Mirrors webapp/content.py. */

// Strip chars that break a quoted mermaid node label; keep unicode (±, –).
const mmNode = (s: string) =>
  (s || "").replace(/[[\]"#|<>{}()]/g, "").replace(/\s+/g, " ").trim().slice(0, 38).replace(/[ .,;:–-]+$/, "");

const PIPELINE_FIELDS: [string, RegExp][] = [
  ["Model", /\*\*(?:Model|Method):\*\*\s*([^\n]+)/i],
  ["Intervention", /\*\*Intervention:\*\*\s*([^\n]+)/i],
  ["Readout", /\*\*Primary readout:\*\*\s*([^\n]+)/i],
  ["Success", /\*\*Success criterion:\*\*\s*([^\n]+)/i],
];

/** Model→Intervention→Readout→Success pipeline mermaid parsed from the
 *  fixed-template proposal body; per-field fallbacks keep it robust. */
function proposalPipelineBody(fullText: string, summary: string, n: number): string {
  const fallbacks: Record<string, string> = {
    Model: "Model system",
    Intervention: mmNode(summary) || "Intervention",
    Readout: "Primary readout",
    Success: "Success threshold",
  };
  const nodes = PIPELINE_FIELDS.map(([label, rx]) => {
    const m = (fullText || "").match(rx);
    return [label, (m ? mmNode(m[1]) : "") || fallbacks[label]] as [string, string];
  });
  const lines = nodes.map(([lbl, val], i) => `  n${i}["${lbl}: ${val}"]`);
  const edges = nodes.slice(1).map((_, i) => `  n${i} --> n${i + 1}`);
  return "```mermaid\n---\n" +
    `title: Prototype experiment pipeline — proposal ${n}\n---\n` +
    "graph LR\n" + [...lines, ...edges].join("\n") + "\n```";
}

/** Mini-donut of the proposal's own cited sources grouped by year, or null. */
function proposalCitationDonutBody(citations: SimCitation[] | undefined, n: number): string | null {
  const cites = citations || [];
  if (!cites.length) return null;
  const counts = new Map<string, number>();
  for (const c of cites) {
    const yr = String(c.year ?? "n.d.");
    counts.set(yr, (counts.get(yr) || 0) + 1);
  }
  const entries = [...counts.entries()].sort((a, b) =>
    a[0] === "n.d." ? 1 : b[0] === "n.d." ? -1 : a[0] < b[0] ? -1 : 1);
  const rows = entries.map(([k, v]) => `| ${cell(k)} | ${v} |`).join("\n");
  const spec = { type: "donut", title: `Cited sources by year — proposal ${n}`, segments: entries.map(([label, value]) => ({ label, value })) };
  return `| Publication year | Sources |
|---|---|
${rows}

\`\`\`chart
${JSON.stringify(spec)}
\`\`\``;
}

/** Single-series Elo sparkline for one proposal, or null when <2 points. */
function proposalEloBody(id: string | undefined, title: string, n: number, figures?: OverviewFigures): string | null {
  if (!id) return null;
  const series = figures?.eloSeries?.[id];
  if (!series || series.length <= 1) return null;
  const spec = { type: "elo", title: `Elo trajectory — proposal ${n}`, series: { [id]: series }, labels: { [id]: title.slice(0, 24) } };
  return `\`\`\`chart\n${JSON.stringify(spec)}\n\`\`\``;
}

/** Detailed research-proposal report. Mirrors the structure of the real
 *  metareview_final.md prompt so demo/sim output matches live output. */
export function makeOverview(goal: string, proposals: OverviewProposal[], figures?: OverviewFigures): string {
  const top = proposals.slice(0, 5);
  const lead = top[0];
  const { refs, markers } = overviewRefs(goal, top);

  const sections = top.map((p, i) => {
    const elo = p.elo != null ? Math.round(p.elo) : "—";
    // Per-proposal illustrations for the top-3: a compact score radar on the Elo
    // line, plus an experiment-pipeline mermaid, a cited-sources donut, and an
    // Elo sparkline at the END of the block. All UNNUMBERED (chart title only)
    // so the section-level Fig.N numbering stays monotonic.
    const radar = i < 3 && p.scores
      ? `\n\n\`\`\`chart\n${JSON.stringify({ type: "radar", title: `Score profile — proposal ${i + 1}`, scores: p.scores })}\n\`\`\``
      : "";
    const endFigs: string[] = [];
    if (i < 3) {
      endFigs.push(proposalPipelineBody(p.fullText ?? "", p.summary, i + 1));
      const donut = proposalCitationDonutBody(p.citations, i + 1);
      if (donut) endFigs.push(donut);
      const eloFig = proposalEloBody(p.id, p.title, i + 1, figures);
      if (eloFig) endFigs.push(eloFig);
    }
    const tail = endFigs.length ? `\n\n${endFigs.join("\n\n")}` : "";
    return `### Proposal ${i + 1}. ${p.title}

**Tournament Elo:** ${elo} · **Generation strategy:** \`${p.strategy}\`${radar}

**The hypothesis.** ${p.summary}

**Why it's promising.** ${markers[i]} It survived repeated head-to-head debates against
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
clinically achievable exposure, or rescue by the mechanism-dead control.${tail}`;
  }).join("\n\n---\n\n");

  // Content figures woven into the relevant upper sections (empty strings when
  // a figure has no data). A slim rating-model note trails under "## Analysis".
  const figs = figureSet(top, figures);
  const donut = figs.donut ? `\n\n${figs.donut}` : "";
  const scores = figs.scores ? `${figs.scores}\n\n` : "";
  const compFigs = [figs.elo, figs.lineage].filter(Boolean).join("\n\n");
  const comparative = compFigs ? `\n\n${compFigs}` : "";

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
is treated as a robustness signal rather than redundancy.${donut}

## Ranked proposals

${scores}${sections}

## Comparative assessment

The top proposals are not interchangeable: some converge on a shared pathway
(mutually reinforcing evidence), while others are genuinely orthogonal bets worth
running in parallel to hedge mechanism risk. Prefer starting with the highest-Elo
idea that also has the cheapest decisive experiment.${comparative}

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

${figs.ratingModel}

${referencesSection(refs)}

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
export function eloUpdate(ra: number, rb: number, winner: "a" | "b", k = 48): [number, number] {
  const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  const sa = winner === "a" ? 1.0 : 0.0;
  const ra2 = ra + k * (sa - ea);
  const rb2 = rb + k * ((1 - sa) - (1 - ea));
  return [round1(ra2), round1(rb2)];
}

function round1(n: number) { return Math.round(n * 10) / 10; }
function round2(n: number) { return Math.round(n * 100) / 100; }

/* ── Recurring self-critique rounds (shared contract with webapp/content.py) ── */

/** Concrete angles a meta-review round attacks the current leaders from; each
 *  round rotates through these so the fabricated critique doesn't repeat. */
const CRITIQUE_ANGLES: [string, string][] = [
  ["citation integrity",
   "at least one supporting citation looks like a plausibility match rather than direct evidence — the cited result is adjacent, not confirmatory"],
  ["mechanistic gap",
   "the causal chain skips a step: the proposed lever and the measured outcome are linked by an intermediate that was never actually established"],
  ["confounding",
   "the predicted effect could be produced by an uncontrolled confounder, so a positive readout would not cleanly implicate the stated mechanism"],
  ["tournament overfitting",
   "this idea may be winning debates on rhetorical crispness rather than truth — its Elo reflects how it argues, not whether it is right"],
  ["external validity",
   "the effect is asserted for the model system but the leap to the real target population is doing a lot of unexamined work"],
  ["measurement validity",
   "the primary readout may be a proxy that moves for reasons unrelated to the phenomenon we actually care about"],
];

export interface CritiqueHyp { title: string; elo: number | null; strategy?: string }

/** Fabricated meta-review self-critique for one recurring work round. Shared
 *  contract with webapp/content.py `make_self_critique`: returns markdown of the
 *  exact shape `## Thinking\n\n…\n\n## Self-critique\n\n…` referencing the
 *  session's current top hypotheses. Deterministic (seeded by goal + round),
 *  varies per round and per top set. */
export function makeSelfCritique(goal: string, roundNo: number, top: CritiqueHyp[]): string {
  const r = makeRng(`${goal}|self_critique|${roundNo}`);
  const names = top.slice(0, 3).map((h) => (h.title || "an untitled idea").trim());
  const lead = names[0] ?? "the current leader";
  const runner = names[1] ?? lead;
  const [angleName, angleBody] = CRITIQUE_ANGLES[(roundNo - 1) % CRITIQUE_ANGLES.length];
  const others = CRITIQUE_ANGLES.filter(([n]) => n !== angleName);
  const [, altBody] = others.length ? r.choice(others) : CRITIQUE_ANGLES[0];

  const thinking =
    `Round ${roundNo}. I am re-reading the current leaderboard before trusting it.\n\n` +
    `1. The top-ranked idea is **${lead}**. I re-derive its claim from first principles and ask whether the tournament rewarded it for being correct or merely for being well-argued.\n` +
    `2. Its closest challenger is **${runner}**. I check whether the gap between them is real signal or just noise from a handful of matches.\n` +
    `3. I walk each finalist's evidence back to its citations and ask, for every link in the chain, *would this survive a domain expert?*\n` +
    `4. I list what a fresh round should probe that the last ${roundNo} round(s) did not.`;
  const critique =
    `Are these actually the best hypotheses, or the best-defended? Looking hard at **${lead}**, I am not convinced. ` +
    `The flaw this round is **${angleName}**: ${angleBody}. That directly weakens the conclusion the ranking leans on.\n\n` +
    `**${runner}** has a second problem — ${altBody}. If that holds, its stated result may be over-claimed, and a citation or two are being asked to carry more weight than they can bear.\n\n` +
    `Next round I will stress-test these specific doubts: re-examine the weakest citation behind **${lead}**, probe the ${angleName} concern with a sharper falsification, and let a re-rank decide whether the current ordering actually holds up.`;
  return `## Thinking\n\n${thinking}\n\n## Self-critique\n\n${critique}`;
}

/* ── Fabricated stress-test stage (shared contract with webapp/content.py) ── */

const STRESS_ATTACKS = [
  "searched for a disconfirming result and found an adjacent study whose effect reversed once a stricter control was added",
  "re-derived the mechanism from scratch and found one causal step is assumed rather than demonstrated",
  "probed the dose/intensity window and found the active range is narrower than the summary implies",
  "checked whether the primary readout is the phenomenon itself or a proxy that can move for unrelated reasons",
];
const STRESS_VERDICTS: [string, string][] = [
  ["holds", "survives the stress test with a bounded caveat"],
  ["holds-with-fix", "holds only after one load-bearing assumption is tightened"],
  ["weakened", "is weakened but salvageable once the claim is narrowed"],
];
const STRESS_FIXES = [
  "restricts the claim to the regime the pilot can actually defend and adds the control the stress test showed was load-bearing",
  "swaps the weakest citation for a direct falsification step and pre-registers the effect-size threshold before any scale-up",
  "narrows the dose/intensity window to where the effect clears noise and adds the orthogonal readout the original lacked",
];
const STRESS_FOUND = [
  "a key citation backed a weaker effect than claimed",
  "the effect shrank under a stricter control",
  "one causal step was assumed, not shown",
  "the readout risked tracking a proxy, not the mechanism",
];
const STRESS_APPLIED = [
  "narrowed the claim and added the missing control",
  "pre-registered the effect threshold and a direct falsification",
  "restricted the dose window to where the effect clears noise",
  "added an orthogonal readout to pin the mechanism",
];

export interface StressHyp { id: string; title: string; summary?: string; citations?: unknown[] }
export interface StressRankEntry {
  tested: { id: string; title: string };
  fix: { id: string; title: string };
  elo: number; parentElo: number;
}

/** Fabricated meta-review stress test for one top hypothesis. Shared contract
 *  with webapp/content.py `make_stress_report`: returns markdown of the shape
 *  `## Thinking\n\n…\n\n## Stress test\n\n…` that actively tries to break the
 *  hypothesis (contradicting evidence, citation audit, feasibility numbers, a
 *  small prototype-scale pilot, verdict). Deterministic (seeded by goal + hyp id
 *  + round); varies per hypothesis. */
export function makeStressReport(goal: string, hyp: StressHyp, roundInfo: { round: number; of: number }): string {
  const title = (hyp.title || "an untitled idea").trim();
  const r = makeRng(`${goal}|stress|${hyp.id}|${roundInfo.round}`);
  const [verdictKey, verdictTxt] = r.choice(STRESS_VERDICTS);
  const attack = r.choice(STRESS_ATTACKS);
  const nCites = (hyp.citations || []).length;
  const haircut = r.randint(20, 55);
  const nUnits = r.choice([6, 8, 12]);
  const weeks = r.choice([2, 3, 4]);
  const effect = r.randint(15, 40);

  const thinking =
    `Stress round ${roundInfo.round}/${roundInfo.of}. I am trying to *break* **${title}**, not defend it.\n\n` +
    `1. Adversarial search: what published result, if it exists, would kill this? I go looking for the disconfirming case specifically.\n` +
    `2. Citation audit: I re-open each of the ${nCites} supporting reference(s) and ask whether it shows *this* effect or an adjacent one.\n` +
    `3. Feasibility math: I put rough numbers on the intervention to see if the claimed effect is plausible at a realistic dose/setting.\n` +
    `4. Then I design the cheapest experiment that could falsify it at prototype scale — before anyone commits real resources.`;
  const report =
    `**What I attacked.** I ${attack}.\n\n` +
    `**Citation check.** Of ${nCites} cited source(s), the load-bearing one supports a ~${haircut}% smaller effect than the summary implies once the stricter control is applied — a real but survivable haircut.\n\n` +
    `**Feasibility numbers.** At a realistic exposure the predicted effect is ~${effect}% of the outcome measure — above noise, but the margin is thin, so any pilot must be powered for it.\n\n` +
    `**Prototype-scale pilot (run this BEFORE scaling).**\n` +
    `- *Model:* the smallest faithful test bed for “${title.slice(0, 60)}”.\n` +
    `- *Intervention:* the hypothesis's own lever, a single dose/setting.\n` +
    `- *Readout:* the primary outcome measure plus one orthogonal check.\n` +
    `- *Scale:* n = ${nUnits} units over ${weeks} weeks — a pilot, not a full study.\n` +
    `- *Success criterion:* a ≥${effect}% shift vs a matched control, pre-registered; anything less kills the scale-up.\n\n` +
    `**Verdict:** \`${verdictKey}\` — the hypothesis ${verdictTxt}. The hardened revision below narrows the claim to what the pilot can actually defend.`;
  return `## Thinking\n\n${thinking}\n\n## Stress test\n\n${report}`;
}

/** Title + summary for the stress-hardened fix child. Shared contract with
 *  webapp/content.py `make_stress_fix`. Deterministic (seeded by hyp id). */
export function makeStressFix(hyp: { id: string; title: string }): { title: string; summary: string } {
  const title = (hyp.title || "an untitled idea").trim();
  const r = makeRng(`fix|${hyp.id}`);
  const fix = r.choice(STRESS_FIXES);
  return {
    title: `${title} — hardened`,
    summary: `A stress-hardened revision of “${title}” that ${fix}. Same core mechanism, but the failure mode the stress test surfaced is now designed out before scaling.`,
  };
}

/** Markdown ordered list of the stress-tested top-3 after re-ranking. Shared
 *  contract with webapp/content.py `make_stress_ranking`. Entries ordered
 *  best-first by the caller; deterministic per tested id. */
export function makeStressRanking(goal: string, ranked3: StressRankEntry[]): string {
  const lines = [
    "## Stress-test ranking (fixes applied)",
    "",
    "After stress-testing the top three and breeding a hardened revision of each, the re-ranked order — with the fix each test forced — is:",
    "",
  ];
  ranked3.forEach((e, i) => {
    const r = makeRng(`${goal}|stressrank|${e.tested.id}`);
    const found = r.choice(STRESS_FOUND);
    const applied = r.choice(STRESS_APPLIED);
    lines.push(
      `${i + 1}. **${e.fix.title}** (\`${e.fix.id}\`, Elo ${Math.round(e.elo)}) — hardened from \`${e.tested.id}\` (parent Elo ${Math.round(e.parentElo)}). *Test found:* ${found}. *Fix applied:* ${applied}.`,
    );
  });
  return lines.join("\n");
}

export type { Rng };
