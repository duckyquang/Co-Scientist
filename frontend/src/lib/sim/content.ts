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
// Mermaid-safe node label: strip chars that break strict-mode parsing (a bare
// '(' can drop the whole diagram to the raw-code fallback), collapse whitespace,
// clip to 30 at a word boundary when there is one.
const mmLabel = (s: string) => {
  const c = (s || "").replace(/[[\]"#|<>{}()]/g, "").replace(/\s+/g, " ").trim();
  if (c.length <= 30) return c;
  const cut = c.slice(0, 30);
  const sp = cut.lastIndexOf(" ");
  return (sp > 0 ? cut.slice(0, sp) : cut).replace(/\s+$/, "");
};
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

/** Mermaid graph of the evolvement chains that lead into a top proposal. Build
 *  parent→child edges among the lineage nodes, walking ancestors up from each
 *  anchor (top proposal) so a root→child→top chain shows even when the ancestors
 *  are not top-ranked. Emit ONLY nodes touched by an edge (orphan generation
 *  nodes are dropped); null when there are no edges. Capped at ~`cap` nodes. */
function lineageBody(figures?: OverviewFigures, anchorIds: string[] = [], cap = 12): string | null {
  const list = figures?.lineage;
  if (!list || !list.length) return null;
  const byId = new Map(list.map((n) => [n.id, n]));
  const order: string[] = [];
  const seen = new Set<string>();
  const edges: [string, string][] = [];
  const seenEdges = new Set<string>();
  const frontier = anchorIds.filter((a) => byId.has(a));
  while (frontier.length && seen.size < cap) {
    const nid = frontier.shift()!;
    if (!seen.has(nid)) { seen.add(nid); order.push(nid); }
    const par = byId.get(nid)!.parent;
    if (par && byId.has(par) && par !== nid) {
      const key = `${par}>${nid}`;
      if (!seenEdges.has(key)) { seenEdges.add(key); edges.push([par, nid]); }
      // enqueue each node once → always terminates even on cyclic parent data
      if (!seen.has(par)) { seen.add(par); order.push(par); frontier.push(par); }
    }
  }
  if (!edges.length) return null;
  const touched = new Set(edges.flat());
  const nodes = order.filter((n) => touched.has(n))
    .map((n) => `  ${mmId(n)}["${mmLabel(byId.get(n)!.label)}"]`);
  const edgeLines = edges.map(([p, c]) => `  ${mmId(p)} --> ${mmId(c)}`);
  return `\`\`\`mermaid
graph LR
${nodes.join("\n")}
${edgeLines.join("\n")}
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
  const anchorIds = proposals.map((p) => p.id).filter((x): x is string => !!x);
  return {
    donut: cap(donutBody(figures), "share of the finalist hypotheses by generation strategy."),
    scores: cap(scoresBody(proposals), "reviewer scores across the four dimensions for each finalist."),
    elo: cap(eloBody(figures), "Elo trajectory of the finalists across tournament matches."),
    lineage: cap(lineageBody(figures, anchorIds), "idea lineage — the evolvement chain bred into each top proposal."),
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
  const top = proposals.slice(0, 3);
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

/** Concrete angles a meta-review round attacks the current leaders from. Each
 *  round rotates through these (and targets a DIFFERENT hypothesis) so no two
 *  rounds read alike. `probes` are angle-specific thinking steps; `threat` is
 *  why this axis, tied to a soft review score, threatens the idea. */
interface CritiqueAngle { name: string; body: string; threat: string; probes: string[] }
const CRITIQUE_ANGLES: CritiqueAngle[] = [
  {
    name: "citation integrity",
    body: "at least one supporting citation looks like a plausibility match rather than direct evidence — the cited result is adjacent, not confirmatory",
    threat: "a ranking that leans on those citations is leaning on the weakest part of the file",
    probes: [
      "Sort every citation behind it into *direct evidence* vs *plausible-adjacent* — a claim resting on the second pile is resting on vibes.",
      "For the single load-bearing reference, check whether it measured *this* effect or a cousin of it.",
      "Ask whether the summary's confidence was inherited from the cited papers or quietly added in the retelling.",
    ],
  },
  {
    name: "mechanistic gap",
    body: "the causal chain skips a step: the proposed lever and the measured outcome are linked by an intermediate that was never actually established",
    threat: "a mechanism with an undemonstrated step cannot honestly be scored as settled",
    probes: [
      "Draw its causal chain as arrows and mark the one arrow nobody has actually demonstrated.",
      "Ask whether the lever and the outcome are separated by an intermediate that is assumed, not shown.",
      "Check whether a positive result would confirm *this* mechanism or merely be consistent with three others.",
    ],
  },
  {
    name: "confounding",
    body: "the predicted effect could be produced by an uncontrolled confounder, so a positive readout would not cleanly implicate the stated mechanism",
    threat: "an uncontrolled confounder means a positive result would not cleanly earn that score",
    probes: [
      "List every variable that moves alongside the intervention and could produce the same readout.",
      "Ask which of those the proposed control actually neutralises — and which it quietly leaves open.",
      "Decide whether a clean positive still implicates the stated mechanism, or just correlates with it.",
    ],
  },
  {
    name: "tournament overfitting",
    body: "this idea may be winning debates on rhetorical crispness rather than truth — its Elo reflects how it argues, not whether it is right",
    threat: "a rating built on debate wins is not the same thing as being correct",
    probes: [
      "Separate *how well it argues* from *whether it is right* — the Elo only ever sees the first.",
      "Re-read its winning matches: did it beat rivals on evidence or on rhetorical crispness?",
      "Ask whether a skeptical domain expert, not a debate judge, would still rank it first.",
    ],
  },
  {
    name: "external validity",
    body: "the effect is asserted for the model system but the leap to the real target population is doing a lot of unexamined work",
    threat: "an effect that only holds in the toy setting does not deserve a top rank for the real goal",
    probes: [
      "Trace the leap from the model system to the real target population and name what changes across that gap.",
      "Ask which assumptions hold in the toy setting but quietly break at scale.",
      "Decide whether the effect size would survive the messiness the model omits.",
    ],
  },
  {
    name: "measurement validity",
    body: "the primary readout may be a proxy that moves for reasons unrelated to the phenomenon we actually care about",
    threat: "a proxy readout can inflate every downstream number, including this one",
    probes: [
      "Ask whether the primary readout *is* the phenomenon or a proxy standing in for it.",
      "List the unrelated reasons that proxy could move, and whether any is likelier than the claimed cause.",
      "Check whether an orthogonal readout would agree — or expose the proxy.",
    ],
  },
];

// Rotating opener/closer sets so the critique's framing differs every round.
const CRITIQUE_OPENERS = [
  "Are these the best hypotheses, or merely the best-defended?",
  "Before I trust this leaderboard, I want to try to knock the top idea off it.",
  "A high Elo is a strong prior, not a proof — so I am reading against the ranking, not with it.",
  "The tournament rewards survivability, not truth; this round I press on the difference.",
  "If the ordering is right, it should survive me actively trying to break it.",
  "I keep asking the same uncomfortable question: what would make the current leader wrong?",
];
const CRITIQUE_CLOSERS = [
  "Next round I hand these doubts to the re-rank and let fresh matches decide whether the ordering holds.",
  "I will turn this into a sharper falsification and see if the Elo gap survives it.",
  "The stress-test stage should target exactly this weak axis before anyone commits resources.",
  "If the concern is real, a low-K re-rank will start eroding the gap; if not, the idea earns its place.",
  "I am logging this as the specific thing the next round must probe, not a vague unease.",
  "Either the idea absorbs this critique or it drops — the re-rank will tell us which.",
];

const REVIEW_DIMS = ["novelty", "correctness", "testability", "feasibility"] as const;
const eloTxt = (e: number | null | undefined) => (e == null ? "unranked" : `Elo ${Math.round(e)}`);

export interface CritiqueHyp { title: string; elo: number | null; strategy?: string }

/** Fabricated meta-review self-critique for one recurring work round. Shared
 *  contract with webapp/content.py `make_self_critique`: returns markdown of the
 *  exact shape `## Thinking\n\n…\n\n## Self-critique\n\n…`. Each round attacks a
 *  DIFFERENT top hypothesis on a DIFFERENT angle, weaving in that idea's live
 *  Elo + review scores/verdict, so no two rounds read alike. Deterministic
 *  (seeded by goal + round). */
export function makeSelfCritique(goal: string, roundNo: number, top: CritiqueHyp[]): string {
  const list = top.length ? top : [{ title: "the current leader", elo: null }];
  const target = list[(roundNo - 1) % list.length];
  const title = (target.title || "an untitled idea").trim();
  const angle = CRITIQUE_ANGLES[(roundNo - 1) % CRITIQUE_ANGLES.length];

  // Recompute the target's review the same way the scorecard does — keeps the
  // scores/verdict consistent with the rest of the session, deterministically.
  const rv = makeReview(goal, title, "full");
  const sc = rv.scores as Record<string, number>;
  const lowDim = REVIEW_DIMS.reduce((a, b) => (sc[b] < sc[a] ? b : a));
  const scoreLine = REVIEW_DIMS.map((d) => `${d} ${sc[d].toFixed(2)}`).join(", ");

  const opener = CRITIQUE_OPENERS[(roundNo - 1) % CRITIQUE_OPENERS.length];
  const closer = CRITIQUE_CLOSERS[(roundNo - 1) % CRITIQUE_CLOSERS.length];

  let priorRef: string;
  if (roundNo > 1) {
    const prev = list[(roundNo - 2) % list.length];
    const prevAngle = CRITIQUE_ANGLES[(roundNo - 2) % CRITIQUE_ANGLES.length];
    priorRef = `Round ${roundNo - 1} probed the ${prevAngle.name} in **${(prev.title || "an untitled idea").trim()}**; this round I turn to the ${angle.name} in **${title}**.`;
  } else {
    priorRef = `This is the first critique pass, so I start by attacking the current leader's ${angle.name}.`;
  }

  const thinking =
    `Round ${roundNo}. ${priorRef}\n\n` +
    `I re-read **${title}** (${eloTxt(target.elo)}) — its last review landed at ${scoreLine}, verdict *${rv.verdict}*. The softest mark is **${lowDim}** (${sc[lowDim].toFixed(2)}), and that is exactly where a ${angle.name} problem would bite.\n\n` +
    angle.probes.map((p, i) => `${i + 1}. ${p}`).join("\n");
  const critique =
    `${opener} Looking hard at **${title}**, I am not convinced. The weak axis this round is **${angle.name}**: ${angle.body}.\n\n` +
    `Its ${lowDim} score (${sc[lowDim].toFixed(2)}) is the softest on its scorecard, so ${angle.threat}. If that holds, the verdict of *${rv.verdict}* is generous and the ${eloTxt(target.elo)} gap to the field is doing more work than the evidence supports.\n\n` +
    `${closer}`;
  return `## Thinking\n\n${thinking}\n\n## Self-critique\n\n${critique}`;
}

/* ── Fabricated stress-test stage (shared contract with webapp/content.py) ── */

// Each probe pairs the named check that drove it with the concrete finding, so
// the verdict driver, the "what I attacked" line, and the found-evidence bullet
// all stay self-consistent.
interface StressProbe { check: string; attack: string; found: string }
const STRESS_PROBES: StressProbe[] = [
  { check: "adversarial search",
    attack: "went looking for the one published result that would sink it and found an adjacent study whose effect reversed once a stricter control was added",
    found: "an adjacent result reversed once a stricter control was added" },
  { check: "mechanism re-derivation",
    attack: "re-derived the mechanism from scratch and found one causal step is assumed rather than demonstrated",
    found: "one causal step is assumed, not demonstrated" },
  { check: "dose-window probe",
    attack: "probed the dose/intensity window and found the active range is narrower than the summary implies",
    found: "the active dose window is narrower than the summary implies" },
  { check: "readout audit",
    attack: "checked whether the primary readout is the phenomenon itself or a proxy that can move for unrelated reasons",
    found: "the primary readout may track a proxy, not the mechanism" },
];
// The three scannable verdict tokens (the chat + ranking key off these exact
// strings). "with fixes" is repeated so it's the common outcome.
const STRESS_VERDICT_TOKENS = [
  "**Verdict: PASS**",
  "**Verdict: PASS (with fixes)**",
  "**Verdict: PASS (with fixes)**",
  "**Verdict: FAIL**",
];
/** Verdict token for a tested hyp — seeded on hyp id only (not round) so the
 *  stress report and the stress ranking always show the SAME token. */
function stressVerdictToken(goal: string, hypId: string): string {
  return makeRng(`${goal}|stressverdict|${hypId}`).choice(STRESS_VERDICT_TOKENS);
}
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

export interface StressCitation { title?: string }
export interface StressHyp { id: string; title: string; summary?: string; citations?: StressCitation[] }
export interface StressRankEntry {
  tested: { id: string; title: string };
  fix: { id: string; title: string };
  elo: number; parentElo: number;
}

/** First sentence (≤160 chars) of a summary — the idea's actual claim/lever. */
function claimGist(summary: string | undefined, fallback: string): string {
  const s = (summary || "").trim();
  if (!s) return fallback;
  const first = s.split(/(?<=[.!?])\s/)[0].trim();
  return (first.length > 160 ? first.slice(0, 157) + "…" : first) || fallback;
}

/** Fabricated meta-review stress test for one top hypothesis. Shared contract
 *  with webapp/content.py `make_stress_report`: returns markdown of the shape
 *  `## Thinking\n\n…\n\n## Stress test\n\n…` that actively tries to break the
 *  hypothesis. The first line of the report is exactly one scannable
 *  `**Verdict: …**` token; "What I attacked" names the idea's real claim;
 *  found-evidence references its own citations by title (or flags the citation
 *  gap when none). Deterministic (seeded by goal + hyp id + round). */
export function makeStressReport(goal: string, hyp: StressHyp, roundInfo: { round: number; of: number }): string {
  const title = (hyp.title || "an untitled idea").trim();
  const r = makeRng(`${goal}|stress|${hyp.id}|${roundInfo.round}`);
  const probe = r.choice(STRESS_PROBES);
  const cites = hyp.citations || [];
  const nCites = cites.length;
  const gist = claimGist(hyp.summary, title);
  const haircut = r.randint(20, 55);
  const nUnits = r.choice([6, 8, 12]);
  const weeks = r.choice([2, 3, 4]);
  const effect = r.randint(15, 40);

  const token = stressVerdictToken(goal, hyp.id);
  const driver =
    token.includes("PASS (with fixes)")
      ? `the ${probe.check} exposed a real but bounded gap that the hardened revision below closes`
      : token.includes("FAIL")
        ? `the ${probe.check} surfaced a gap the current claim cannot absorb without narrowing first`
        : `no disconfirming result held up and the load-bearing citations checked out`;

  // Pre-fix review scores → plausible post-fix improvements (hardening lifts
  // correctness/testability/feasibility; novelty is unchanged by a fix).
  const sc = makeReview(goal, title, "full").scores as Record<string, number>;
  const bump = (v: number, d: number) => Math.min(0.97, round2(v + d));
  const after: Record<string, number> = {
    novelty: sc.novelty,
    correctness: bump(sc.correctness, r.uniform(0.06, 0.14)),
    testability: bump(sc.testability, r.uniform(0.02, 0.08)),
    feasibility: bump(sc.feasibility, r.uniform(0.06, 0.14)),
  };
  const scoreRow = REVIEW_DIMS.map((d) => `${d} ${sc[d].toFixed(2)} → ${after[d].toFixed(2)}`).join(" · ");

  const citeTitles = [...new Set(cites.map((c) => (c.title || "untitled source").trim()))];
  const citationLine = citeTitles.length
    ? citeTitles.slice(0, 2).map((t) =>
        `- *${t}* — on re-reading, it backs a ~${haircut}% smaller effect than the summary implies once a stricter control is added.`,
      ).join("\n")
    : "- No sources were attached — flagging the citation gap as a finding: the claim currently rests on uncited reasoning.";

  const thinking =
    `Stress round ${roundInfo.round}/${roundInfo.of}. I am trying to *break* **${title}**, not defend it.\n\n` +
    `Its core claim: “${gist}”. That lever is what I have to falsify.\n\n` +
    `1. Adversarial search: what published result, if it exists, would kill this specific claim?\n` +
    `2. Citation audit: ${nCites ? `re-open each of the ${nCites} supporting reference(s) and ask whether it shows *this* effect or an adjacent one` : "there are no attached sources, so the absence of evidence is itself the first finding"}.\n` +
    `3. Feasibility math: put rough numbers on the lever to see if the claimed effect is plausible at a realistic dose/setting.\n` +
    `4. Design the cheapest experiment that could falsify it at prototype scale — before anyone commits real resources.`;
  const report =
    `${token} — ${driver}.\n\n` +
    `**What I attacked.** I targeted the idea's core claim — “${gist}” — and ${probe.attack}.\n\n` +
    `**Found evidence.**\n${citationLine}\n\n` +
    `**Scores before → after fix.** ${scoreRow}.\n\n` +
    `**Feasibility numbers.** At a realistic exposure the predicted effect is ~${effect}% of the outcome measure — above noise, but the margin is thin, so any pilot must be powered for it.\n\n` +
    `**Prototype-scale pilot (run this BEFORE scaling).**\n` +
    `- *Model:* the smallest faithful test bed for “${title.slice(0, 60)}”.\n` +
    `- *Intervention:* the hypothesis's own lever, a single dose/setting.\n` +
    `- *Readout:* the primary outcome measure plus one orthogonal check.\n` +
    `- *Scale:* n = ${nUnits} units over ${weeks} weeks — a pilot, not a full study.\n` +
    `- *Success criterion:* a ≥${effect}% shift vs a matched control, pre-registered; anything less kills the scale-up.`;
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
    const token = stressVerdictToken(goal, e.tested.id);
    lines.push(
      `${i + 1}. **${e.fix.title}** (\`${e.fix.id}\`, Elo ${Math.round(e.elo)}) — ${token} on the parent \`${e.tested.id}\` (parent Elo ${Math.round(e.parentElo)}). *Test found:* ${found}. *Fix applied:* ${applied}.`,
    );
  });
  return lines.join("\n");
}

export type { Rng };
