/** In-browser session engine — the zero-backend "free for everyone" path.
 *
 * The whole tournament is expressed as a deterministic *timeline* (built once
 * per session). Any read computes "what state is this session in, given how
 * much wall-clock has elapsed" — so the leaderboard, gauges and activity feed
 * animate live with no server. Sessions persist in localStorage, so a refresh
 * resumes exactly where it was.
 *
 * Two content sources feed the same timeline:
 *  • GROQ mode (a build-time VITE_GROQ_API_KEY is present) — we call Groq to
 *    generate hypotheses that genuinely READ the user's prompt, then run the
 *    tournament over that real content.
 *  • SIM mode (no key) — falls back to templated, prompt-seeded placeholder
 *    content so the demo still works offline. Clearly labeled as a simulation.
 * When a real backend is configured (VITE_API_URL) the app bypasses this file.
 */

import type {
  ClusterPoint, CostByAgent, Feedback, Hypothesis, LineageNode, Match,
  Metrics, SessionDetail, SessionRow, SSEvent,
} from "../../types";
import type { LiveTick } from "../hooks";
import { classifyIntent, composeRerunGoal, OUT_OF_SCOPE } from "./chatRouter";
import { eloUpdate, figureSet, insertAfterHeading, makeHypothesis, makeOverview, makePlan, makeReview, makeSelfCritique, makeStressFix, makeStressRanking, makeStressReport, referencesSection, SIM_MODEL, STRATEGIES } from "./content";
import { generateSession, type GenHyp, type GeneratedContent } from "./generate";
import { hasRealProvider } from "../llm";
import { makeRng } from "./rng";

/** One chat turn — structurally matches api.ts ChatTurn (kept local to avoid a
 *  circular import between api.ts and this module). */
interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  intent?: string | null;
  new_session_id?: string | null;
  created_at: string;
}

const STORAGE_KEY = "cosci_sim_sessions_v1";
const DEFAULT_BUDGET_TOKENS = 5_000_000;
const DEFAULT_WALL_CLOCK_SECONDS = 1800;
const TOKENS_PER_USD = 220_000;
/** Hard ceiling on live generation before we fall back to the template. */
const GEN_TIMEOUT_MS = 60_000;
/** Session ids with a live generateSession promise in THIS tab. A record can
 *  persist `generating: true` across a refresh, but the promise cannot — so the
 *  pending spinner is only valid while the id is in here. */
const _inFlight = new Set<string>();

/* ── Persisted record ──────────────────────────────────────── */
export interface SimRecord {
  id: string;
  goal: string;
  budget_tokens: number;
  wall_clock_seconds: number;
  budget_usd?: number; // legacy records only; cost is now a derived stat
  n_initial: number;
  speed: number; // seconds multiplier (lower = faster), matches NewSession
  created_ms: number;
  pausedAccumMs: number;
  pauseStartedMs: number | null;
  status: "running" | "paused" | "done" | "aborted";
  frozenSimSec: number | null; // set on abort
  origin_session_id?: string | null; // rerun-chain ROOT (tweak spawns); null = own root
  feedback: Feedback[];
  chat?: ChatMsg[];            // follow-up conversation (persisted in localStorage)
  stateOverrides: Record<string, Hypothesis["state"]>;
  // Real-content (Groq) fields:
  mode?: "groq" | "sim";       // groq = real LLM read the prompt; sim = templates
  generating?: boolean;        // groq call in flight (no content yet)
  genError?: string | null;    // groq call failed
  content?: GeneratedContent;  // real hypotheses + overview from Groq
}

/* ── Timeline (built deterministically, never persisted) ───── */
interface Step {
  t: number; agent: string; action: string; model: string;
  cost: number; input_tokens: number; output_tokens: number;
  cache_read: number; cache_write: number;
}
interface HypReview {
  verdict: string;
  scores: { novelty: number; correctness: number; testability: number; feasibility: number };
  body: string;
}
interface PlanHyp {
  id: string; idx: number; strategy: string;
  created_by: "generation" | "evolution"; parents: string[];
  tCreate: number; tReview: number;
  elo0: number; // quality-seeded initial Elo (1000..1800)
  title: string; summary: string; full_text: string;
  citations: { title: string; url: string; excerpt: string | null; doi: string | null; year: number | null }[];
  review: HypReview;
}
interface PlanMatch {
  id: string; t: number; hyp_a: string; hyp_b: string; mode: string;
  winner: "a" | "b"; elo_a_before: number; elo_b_before: number;
  elo_a_after: number; elo_b_after: number; rationale: string; similarity: number;
}
interface PlanEvent { t: number; agent: string; event: string; payload: any }
interface Plan {
  steps: Step[]; hyps: PlanHyp[]; matches: PlanMatch[]; events: PlanEvent[];
  tEnd: number; pinnedId: string | null; overview: string;
  utilTarget: number; // per-session budget-gauge cap (0.90..0.99)
  metaFeedback: Feedback;
  critiques: { t: number; fb: Feedback }[]; // recurring self-critique rounds, timed
  stress: { t: number; fb: Feedback }[];    // stress-test reports + ranking, timed
  pending?: boolean; // groq generation still in flight (or failed)
  failed?: boolean;  // groq generation errored
}

/** Per-session utilization target range: each session draws a deterministic
 *  target in [0.90, 0.99] so finished runs land at *varied* 90-99% utilization
 *  instead of a fixed 95%. The self-critique loop fills to target−CRITIQUE_GAP;
 *  the stress-test stage tops up to the target. Never >100% (99% clamp below). */
const UTIL_MIN = 0.90;
const UTIL_MAX = 0.99;
const CRITIQUE_GAP = 0.10;
/** Initial-Elo seeding, mirroring the real engine's review-composite seeding:
 *  hidden quality q ∈ [0.05, 0.95] per hyp → Elo = BASE + SPAN·q + noise. */
const ELO_SEED_BASE = 1000;
const ELO_SEED_SPAN = 800;
/** Each round burns ~this fraction of the budget, so round count stays bounded
 *  (~3-5) for any budget → wall time stays close to today's. */
const CRITIQUE_ROUND_FRACTION = 0.22;
const MAX_CRITIQUE_ROUNDS = 8;
/** Token chunk each stress-test report spends (budget-scaled, clamped to the
 *  utilization target). 3 tested hyps × this covers the critique→target gap. */
const STRESS_TEST_FRACTION = 0.05;

/** Assemble a markdown body from Groq's structured hypothesis fields. */
function assembleFullText(g: GenHyp): string {
  const parts: string[] = [];
  if (g.mechanism) parts.push(`## Mechanism\n\n${g.mechanism}`);
  if (g.experiment) parts.push(`## Proposed experiment\n\n${g.experiment}`);
  if (g.predicted_outcome) parts.push(`## Predicted outcome\n\n${g.predicted_outcome}`);
  return parts.join("\n\n") || g.summary;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/* ── Plan builder (memoized per session) ───────────────────── */
const _planCache = new Map<string, Plan>();

function buildPlan(rec: SimRecord): Plan {
  // Still generating with a live model and within the time budget → a
  // "preparing" placeholder plan (not cached, so the real plan builds the moment
  // content lands). Past the budget (or once generating clears) we DON'T hang
  // here — we fall through and build the tournament from the prompt-aware
  // content.ts templates, so a session never gets stuck or hard-fails.
  const generatingActive =
    rec.mode === "groq" && !rec.content && rec.generating && _inFlight.has(rec.id) &&
    Date.now() - rec.created_ms < GEN_TIMEOUT_MS + 5_000;
  if (generatingActive) {
    const events: PlanEvent[] = [
      { t: 0, agent: "supervisor", event: "session_started", payload: { goal: rec.goal.slice(0, 200) } },
      { t: 0, agent: "generation", event: "task_started", payload: { agent: "generation", action: "Reading your prompt — generating hypotheses…" } },
    ];
    return {
      steps: [], hyps: [], matches: [], events, tEnd: Infinity, pinnedId: null, overview: "",
      utilTarget: UTIL_MAX,
      metaFeedback: { id: `fb_${rec.id}_meta`, created_at: new Date(rec.created_ms).toISOString(), source: "meta_review", kind: "system_feedback", target_id: null, active: 1, text: "" },
      critiques: [],
      stress: [],
      pending: true,
    };
  }

  const cacheKey = `${rec.id}|${rec.goal}|${rec.n_initial}|${rec.content ? "g" : "s"}`;
  const cached = _planCache.get(cacheKey);
  if (cached) return cached;

  const { id: simId, goal, n_initial: n } = rec;
  const r = makeRng(simId);
  // Per-session utilization target — finished gauges read 90-99%, varied.
  const utilTarget = makeRng(`${simId}|util`).uniform(UTIL_MIN, UTIL_MAX);
  let t = 0;
  let matchCounter = 0;
  let tokSum = 0; // running input+output tokens (drives the budget gauge)
  const steps: Step[] = [];
  const events: PlanEvent[] = [];
  const hyps: PlanHyp[] = [];
  const matches: PlanMatch[] = [];
  const elo = new Map<string, number>();

  const hypId = (idx: number) => `hyp_${simId}_${idx}`;
  const emit = (agent: string, event: string, payload: any) => events.push({ t, agent, event, payload });
  const transcript = (agent: string, action: string, lo: number, hi: number) => {
    const cost = round4(r.uniform(lo, hi));
    const it = r.randint(1500, 9000);
    const ot = r.randint(400, 3500);
    tokSum += it + ot;
    steps.push({
      t, agent, action, model: SIM_MODEL, cost,
      input_tokens: it, output_tokens: ot,
      cache_read: r.randint(0, it), cache_write: r.randint(0, 800),
    });
  };
  // A step whose input+output tokens sum to exactly `tokens` — used by the
  // self-critique rounds to spend a big, budget-scaled chunk in one call.
  const critiqueStep = (agent: string, action: string, tokens: number) => {
    const it = Math.round(tokens * 0.7);
    const ot = Math.max(0, tokens - it);
    tokSum += it + ot;
    steps.push({
      t, agent, action, model: SIM_MODEL, cost: round4(tokens / TOKENS_PER_USD),
      input_tokens: it, output_tokens: ot,
      cache_read: r.randint(0, it), cache_write: r.randint(0, 800),
    });
  };
  // idx doubles as the index into real (Groq) content; falls back to templates.
  const hypContent = (idx: number, strategy: string) => {
    const g = rec.content?.hyps[idx];
    if (g) {
      return {
        title: g.title, summary: g.summary, full_text: assembleFullText(g),
        citations: [] as PlanHyp["citations"],
        review: {
          verdict: g.verdict,
          scores: { novelty: g.novelty, correctness: g.correctness, testability: g.testability, feasibility: g.feasibility },
          body: g.critique,
        } as HypReview,
      };
    }
    const c = makeHypothesis(goal, idx, strategy);
    const rv = makeReview(goal, c.title, "full");
    return {
      title: c.title, summary: c.summary, full_text: c.full_text, citations: c.citations,
      review: { verdict: rv.verdict, scores: rv.scores, body: rv.body } as HypReview,
    };
  };
  /** Win probability from each idea's fixed quality anchor (seed Elo, elo0), not
   *  its drifting live Elo — so consistent winners climb toward 2000 and losers
   *  fall toward 1000 instead of mean-reverting, spreading the leaderboard. */
  const pWinA = (a: PlanHyp, b: PlanHyp) => 1 / (1 + Math.pow(10, (b.elo0 - a.elo0) / 400));
  /** Quality-seeded initial Elo: evolution children inherit their best parent's
   *  rating + a small boost; fresh generations get a hidden quality stratified
   *  across the batch by index (with per-id jitter) so seeds reliably span the
   *  range — independent draws over a small batch occasionally cluster. */
  const seedElo = (id: string, idx: number, parents: string[]): number => {
    const parentElos = parents.map((p) => elo.get(p)).filter((e): e is number => e != null);
    if (parentElos.length) return round1(Math.max(...parentElos) + r.uniform(10, 40));
    const rq = makeRng(`${id}|q`);
    const frac = Math.min(1, Math.max(0, (idx + rq.uniform(-0.4, 0.4)) / Math.max(1, n - 1)));
    const q = 0.05 + 0.90 * frac;
    return round1(ELO_SEED_BASE + ELO_SEED_SPAN * q + rq.uniform(-15, 15));
  };
  const addHyp = (idx: number, strategy: string, createdBy: "generation" | "evolution", parents: string[]): PlanHyp => {
    const c = hypContent(idx, strategy);
    const h: PlanHyp = {
      id: hypId(idx), idx, strategy, created_by: createdBy, parents,
      tCreate: t, tReview: t, elo0: seedElo(hypId(idx), idx, parents),
      title: c.title, summary: c.summary, full_text: c.full_text, citations: c.citations, review: c.review,
    };
    hyps.push(h);
    elo.set(h.id, h.elo0);
    transcript(createdBy, `${createdBy}.${strategy}`, 0.04, 0.2);
    emit(createdBy, "hypothesis_created", { hypothesis_id: h.id, title: c.title.slice(0, 80), strategy });
    return h;
  };
  const review = (h: PlanHyp) => {
    transcript("reflection", "reflection.full", 0.03, 0.1);
    emit("reflection", "review_completed", { hypothesis_id: h.id, kind: "full" });
  };
  const ranking = (pool: PlanHyp[], rounds: number) => {
    for (let rd = 0; rd < rounds; rd++) {
      const shuffled = r.shuffle(pool);
      for (let k = 0; k + 1 < shuffled.length; k += 2) {
        const a = shuffled[k], b = shuffled[k + 1];
        t += 1.2;
        const mode = r.random() < 0.35 ? "debate" : "pairwise";
        const ea = elo.get(a.id)!, eb = elo.get(b.id)!;
        const winner: "a" | "b" = r.random() < pWinA(a, b) ? "a" : "b";
        const [ra, rb] = eloUpdate(ea, eb, winner);
        const mid = `mat_${simId}_${matchCounter++}`;
        matches.push({
          id: mid, t, hyp_a: a.id, hyp_b: b.id, mode, winner,
          elo_a_before: ea, elo_b_before: eb, elo_a_after: ra, elo_b_after: rb,
          rationale: `Idea ${winner.toUpperCase()} gave a sharper falsification criterion.`,
          similarity: round2(r.uniform(0.05, 0.4)),
        });
        elo.set(a.id, ra); elo.set(b.id, rb);
        transcript("ranking", `ranking.${mode}`, 0.01, 0.05);
        emit("ranking", "match_complete", { match_id: mid, winner, mode });
      }
    }
  };

  // ── Phase 0: session start ──
  emit("supervisor", "session_started", { goal: goal.slice(0, 200), n_initial: n, budget_tokens: rec.budget_tokens });

  // ── Phase 1: generation ──
  emit("generation", "task_started", { agent: "generation", action: "CreateInitialHypotheses" });
  const initial: PlanHyp[] = [];
  for (let i = 0; i < n; i++) {
    t += 2.5;
    const h = addHyp(i, STRATEGIES[i % 3], "generation", []);
    t += 1.5;
    h.tReview = t;
    review(h);
    initial.push(h);
  }

  // ── Phase 2: ranking (2 rounds) ──
  ranking(initial, 2);

  // ── Phase 3: evolution (2 rounds, interleaved with ranking) ──
  // Each round breeds 2 offspring from the CURRENT top-ranked parents; the
  // ranking round in between re-orders the field, so round 2's parents reflect
  // the new standings. The 3.0 pre-round gap keeps each round's tCreate cluster
  // clearly separated — the chat groups offspring into rounds by these gaps.
  for (let evRound = 0; evRound < 2; evRound++) {
    t += 3.0;
    emit("evolution", "task_started", { agent: "evolution", action: "EvolveTopHypotheses" });
    const top3 = [...hyps].sort((x, y) => elo.get(y.id)! - elo.get(x.id)!).slice(0, 3);
    ["combine", "out_of_box"].forEach((strat, j) => {
      t += 2.0;
      const parents = strat === "combine" && top3.length > 1 ? [top3[0].id, top3[1].id] : [top3[0].id];
      const h = addHyp(n + evRound * 2 + j, strat, "evolution", parents);
      h.tReview = t;
      review(h);
    });
    if (evRound === 0) ranking(hyps, 1);
  }

  // ── Phase 4: ranking again (all hyps, 2 rounds) ──
  ranking(hyps, 2);

  // ── Phase 4.5: recurring self-critique rounds ──
  // Keep reasoning past the fixed phases: each round writes a meta-review
  // self-critique (re-questioning the leaders) + a short low-K re-rank burst,
  // looping until simulated token spend reaches utilTarget−CRITIQUE_GAP of the
  // budget. The per-round chunk scales with the budget so the round COUNT
  // stays bounded.
  const budgetTok = rec.budget_tokens > 0 ? rec.budget_tokens : DEFAULT_BUDGET_TOKENS;
  const targetTok = (utilTarget - CRITIQUE_GAP) * budgetTok;
  const perRound = Math.max(1, Math.floor(CRITIQUE_ROUND_FRACTION * budgetTok));
  const critiques: { t: number; fb: Feedback }[] = [];
  let critRound = 0;
  while (tokSum < targetTok && critRound < MAX_CRITIQUE_ROUNDS) {
    critRound++;
    t += 1.5;
    const ordered = [...hyps].sort((x, y) => elo.get(y.id)! - elo.get(x.id)!);
    const text = makeSelfCritique(goal, critRound,
      ordered.map((h) => ({ title: h.title, elo: elo.get(h.id) ?? null, strategy: h.strategy })));
    const addTok = Math.min(perRound, Math.max(0, Math.floor(targetTok - tokSum)));
    critiqueStep("metareview", "metareview.self_critique", addTok);
    emit("metareview", "task_completed", { agent: "metareview", kind: "self_critique", round: critRound, action: "SelfCritique" });
    critiques.push({
      t, fb: {
        id: `fb_${simId}_sc${critRound}`, created_at: isoAt(rec, t),
        source: "meta_review", kind: "self_critique", target_id: null, active: 1, text,
      },
    });
    // Re-rank burst: 2 low-K matches → Elo wobbles but the wide gaps from the
    // main tournament keep the ordering stable.
    for (let bi = 0; bi < 2 && hyps.length >= 2; bi++) {
      t += 0.8;
      const [a, b] = r.sample(hyps, 2);
      const mode = r.random() < 0.35 ? "debate" : "pairwise";
      const ea = elo.get(a.id)!, eb = elo.get(b.id)!;
      const winner: "a" | "b" = r.random() < pWinA(a, b) ? "a" : "b";
      const [ra, rb] = eloUpdate(ea, eb, winner, 6);
      const mid = `mat_${simId}_${matchCounter++}`;
      matches.push({
        id: mid, t, hyp_a: a.id, hyp_b: b.id, mode, winner,
        elo_a_before: ea, elo_b_before: eb, elo_a_after: ra, elo_b_after: rb,
        rationale: `Idea ${winner.toUpperCase()} held up under re-examination.`,
        similarity: round2(r.uniform(0.05, 0.4)),
      });
      elo.set(a.id, ra); elo.set(b.id, rb);
      transcript("ranking", `ranking.${mode}`, 0.01, 0.05);
      emit("ranking", "match_complete", { match_id: mid, winner, mode });
    }
  }

  // ── Phase 4.6: fabricated stress-test stage ──
  // Mimics the real engine's stress-test stage so the demo shows the full
  // workflow: take the top-3 leaders, write a meta-review stress report + review
  // for each, breed a hardened fix child (seeded just above its parent), a short
  // re-rank burst so the fixes generally overtake their parents, then a
  // stress_ranking summary. Tops token spend from the critique level up to the
  // per-session utilTarget.
  const stress: { t: number; fb: Feedback }[] = [];
  if (hyps.length >= 2) {
    const stressTop3 = [...hyps].sort((x, y) => elo.get(y.id)! - elo.get(x.id)!).slice(0, 3);
    const stressTargetTok = utilTarget * budgetTok;
    const perStress = Math.max(1, Math.floor(STRESS_TEST_FRACTION * budgetTok));
    const pairs: { parent: PlanHyp; child: PlanHyp }[] = [];
    stressTop3.forEach((h, k) => {
      t += 1.5;
      emit("stresstest", "task_started", { agent: "stresstest", action: "StressTest", hypothesis_id: h.id });
      const report = makeStressReport(goal,
        { id: h.id, title: h.title, summary: h.summary, citations: h.citations },
        { round: k + 1, of: stressTop3.length });
      stress.push({
        t, fb: {
          id: `fb_${simId}_st${k}`, created_at: isoAt(rec, t),
          source: "meta_review", kind: "stress_test", target_id: h.id, active: 1, text: report,
        },
      });
      const addTok = Math.min(perStress, Math.max(0, Math.floor(stressTargetTok - tokSum)));
      critiqueStep("stresstest", "stresstest.report", addTok);
      emit("stresstest", "task_completed", { agent: "stresstest", kind: "stress_test", hypothesis_id: h.id, action: "StressTest" });
      // Hardened fix child: strategy feedback_driven, created by evolution,
      // parent = the tested hyp, seeded just above the parent's current Elo.
      t += 1.5;
      const fix = makeStressFix({ id: h.id, title: h.title });
      const cidx = hyps.length; // next free hyp-id index (after all evolution rounds)
      const rv = makeReview(goal, fix.title, "full");
      // Inherit parent quality + a small boost so hardened ideas rank high.
      const childElo = round1(elo.get(h.id)! + r.uniform(10, 30));
      const child: PlanHyp = {
        id: hypId(cidx), idx: cidx, strategy: "feedback_driven",
        created_by: "evolution", parents: [h.id], tCreate: t, tReview: t,
        elo0: childElo,
        title: fix.title, summary: fix.summary,
        full_text: `## Hardening\n\n${fix.summary}`,
        citations: h.citations,
        review: { verdict: rv.verdict, scores: rv.scores, body: rv.body },
      };
      hyps.push(child);
      elo.set(child.id, childElo);
      transcript("evolution", "evolution.feedback_driven", 0.04, 0.2);
      emit("evolution", "hypothesis_created", { hypothesis_id: child.id, title: fix.title.slice(0, 80), strategy: "feedback_driven" });
      review(child);
      pairs.push({ parent: h, child });
    });
    // Re-rank burst: 2 random wobble matches (low K) first, then each child
    // beats its parent (higher K) so the fixes end up on top.
    const stressMatch = (a: PlanHyp, b: PlanHyp, winner: "a" | "b", k: number, rationale: string) => {
      t += 0.8;
      const ea = elo.get(a.id)!, eb = elo.get(b.id)!;
      const [ra, rb] = eloUpdate(ea, eb, winner, k);
      const mid = `mat_${simId}_${matchCounter++}`;
      matches.push({
        id: mid, t, hyp_a: a.id, hyp_b: b.id, mode: "pairwise", winner,
        elo_a_before: ea, elo_b_before: eb, elo_a_after: ra, elo_b_after: rb,
        rationale, similarity: round2(r.uniform(0.05, 0.4)),
      });
      elo.set(a.id, ra); elo.set(b.id, rb);
      transcript("ranking", "ranking.pairwise", 0.01, 0.05);
      emit("ranking", "match_complete", { match_id: mid, winner, mode: "pairwise" });
    };
    for (let bi = 0; bi < 2 && hyps.length >= 2; bi++) {
      const [a, b] = r.sample(hyps, 2);
      const w: "a" | "b" = r.random() < pWinA(a, b) ? "a" : "b";
      stressMatch(a, b, w, 6, `Idea held up under re-examination.`);
    }
    for (const { parent, child } of pairs) {
      stressMatch(child, parent, "a", 16, "Hardened revision beat its parent under stress re-test.");
    }
    // stress_ranking summary, ordered by the fix children's final Elo.
    t += 0.8;
    const ranked = pairs
      .map(({ parent, child }) => ({
        tested: { id: parent.id, title: parent.title },
        fix: { id: child.id, title: child.title },
        elo: elo.get(child.id)!, parentElo: elo.get(parent.id)!,
      }))
      .sort((a, b) => b.elo - a.elo);
    stress.push({
      t, fb: {
        id: `fb_${simId}_strank`, created_at: isoAt(rec, t),
        source: "meta_review", kind: "stress_ranking", target_id: null, active: 1,
        text: makeStressRanking(goal, ranked),
      },
    });
  }

  // ── Phase 5: finalize ──
  const tEnd = t;
  const finalRank = [...hyps].sort((x, y) => elo.get(y.id)! - elo.get(x.id)!);
  const pinnedId = finalRank.length ? finalRank[0].id : null;
  transcript("metareview", "metareview.final", 0.05, 0.15);
  // Assemble deterministic figures from real session data (scores, strategy mix,
  // lineage, Elo trajectories) so the proposal's charts are always correct.
  const proposals = finalRank.slice(0, 5).map((h) => ({
    id: h.id, title: h.title, summary: h.summary, strategy: h.strategy,
    elo: elo.get(h.id) ?? null, scores: h.review.scores,
    fullText: h.full_text, citations: h.citations,
  }));
  const strategyCounts: Record<string, number> = {};
  for (const h of hyps) strategyCounts[h.strategy] = (strategyCounts[h.strategy] || 0) + 1;
  const lineage = hyps.map((h) => ({
    id: h.id, label: h.title, parent: h.parents[0] ?? null,
    kind: (h.created_by === "evolution" ? "evo" : "gen") as "gen" | "evo",
  }));
  const topIds = finalRank.slice(0, 5).map((h) => h.id);
  const eloSeries: Record<string, { i: number; elo: number }[]> = {};
  const eloLabels: Record<string, string> = {};
  matches.forEach((m, mi) => {
    if (topIds.includes(m.hyp_a)) (eloSeries[m.hyp_a] ||= []).push({ i: mi, elo: m.elo_a_after });
    if (topIds.includes(m.hyp_b)) (eloSeries[m.hyp_b] ||= []).push({ i: mi, elo: m.elo_b_after });
  });
  for (const h of finalRank.slice(0, 5)) eloLabels[h.id] = h.title.slice(0, 24);
  const figures = { strategyCounts, lineage, eloSeries, eloLabels };

  // Groq gives a prompt-specific prose overview with its own ## sections. Wrap it
  // in the same header shape the template uses (# title + **Research goal.**) so
  // every consumer — the report panel AND the microsite hero/TOC/body — treats
  // both paths identically; weave the donut into the first section and the
  // scorecard into the second, and trail the remaining figures under ## Analysis.
  // The browser LLM writes prose but retrieves no literature, so its proposal
  // gets an honest "no verifiable sources" References section rather than
  // fabricated citations. The template path (makeOverview) builds its own.
  const groqProse = rec.content?.overview?.trim();
  let overview: string;
  if (groqProse) {
    const prose = /^##\s/m.test(groqProse) ? groqProse : `## Overview\n\n${groqProse}`;
    const nHeadings = (prose.match(/^##\s/gm) || []).length;
    const figs = figureSet(proposals, figures);
    let body = `# Research proposal\n\n**Research goal.** ${goal}\n\n${prose}`;
    body = insertAfterHeading(body, 1, figs.donut);
    if (nHeadings >= 2) body = insertAfterHeading(body, 2, figs.scores);
    // If the model gave fewer than two sections, keep the scorecard rather than
    // drop it — it trails with the remaining figures instead.
    const trailing = [nHeadings >= 2 ? "" : figs.scores, figs.elo, figs.lineage, figs.ratingModel]
      .filter(Boolean).join("\n\n");
    overview = `${body}\n\n## Analysis\n\n${trailing}\n\n${referencesSection(null)}`;
  } else {
    overview = makeOverview(goal, proposals, figures);
  }
  emit("metareview", "session_done", { stop_reason: "BUDGET" });
  const metaFeedback: Feedback = {
    id: `fb_${simId}_meta`, created_at: isoAt(rec, tEnd), source: "meta_review",
    kind: "system_feedback", target_id: null, active: 1,
    text: "Top candidates converge on a shared pathway — a robust signal. Consider one more out-of-box round to stress-test the consensus.",
  };

  const plan: Plan = { steps, hyps, matches, events, tEnd, pinnedId, overview, utilTarget, metaFeedback, critiques, stress, pending: false, failed: false };
  _planCache.set(cacheKey, plan);
  return plan;
}

/* ── Time helpers ──────────────────────────────────────────── */
/** Defensive: a legacy/corrupted persisted record could carry speed 0 or
 *  undefined, which would divide-by-zero (→ Infinity/NaN → Invalid Date). */
function safeSpeed(rec: SimRecord): number {
  return Number.isFinite(rec.speed) && rec.speed > 0 ? rec.speed : 0.5;
}
function isoAt(rec: SimRecord, simSec: number): string {
  return new Date(rec.created_ms + simSec * safeSpeed(rec) * 1000).toISOString();
}
function elapsedSimSec(rec: SimRecord, nowMs: number): number {
  let pausedMs = rec.pausedAccumMs;
  if (rec.status === "paused" && rec.pauseStartedMs != null) pausedMs += nowMs - rec.pauseStartedMs;
  const realSec = Math.max(0, (nowMs - rec.created_ms - pausedMs) / 1000);
  return realSec / safeSpeed(rec);
}

/* ── Snapshot — the heart of the engine ────────────────────── */
interface Snapshot {
  rec: SimRecord; plan: Plan; el: number;
  status: SessionRow["status"];
}
function snapshot(rec: SimRecord, nowMs = Date.now()): Snapshot {
  const plan = buildPlan(rec);
  // Live generation in flight — nothing to replay yet; show a "running" preparing state.
  if (plan.pending) {
    return { rec, plan, el: 0, status: "running" };
  }
  let el: number;
  let status: SessionRow["status"];
  if (rec.status === "aborted") {
    el = rec.frozenSimSec ?? elapsedSimSec(rec, nowMs);
    status = "aborted";
  } else {
    el = elapsedSimSec(rec, nowMs);
    if (el >= plan.tEnd) { el = plan.tEnd; status = "done"; }
    else if (rec.status === "paused") status = "paused";
    else status = "running";
  }
  return { rec, plan, el, status };
}

/* ── Derived views off a snapshot ──────────────────────────── */
function visibleHyps(s: Snapshot): PlanHyp[] {
  return s.plan.hyps.filter((h) => h.tCreate <= s.el);
}
function currentElo(s: Snapshot, h: PlanHyp): number | null {
  if (h.tReview > s.el) return null; // still a draft → no Elo yet
  let e = h.elo0;
  for (const m of s.plan.matches) {
    if (m.t > s.el) break;
    if (m.hyp_a === h.id) e = m.elo_a_after;
    else if (m.hyp_b === h.id) e = m.elo_b_after;
  }
  return e;
}
function matchesPlayed(s: Snapshot, h: PlanHyp): number {
  let c = 0;
  for (const m of s.plan.matches) {
    if (m.t > s.el) break;
    if (m.hyp_a === h.id || m.hyp_b === h.id) c++;
  }
  return c;
}
function hypState(s: Snapshot, h: PlanHyp): Hypothesis["state"] {
  const override = s.rec.stateOverrides[h.id];
  if (override) return override;
  if (h.tReview > s.el) return "draft";
  if (s.status === "done" && h.id === s.plan.pinnedId) return "pinned";
  return "in_tournament";
}
function clusterId(idx: number, n: number): string {
  return `clu_${idx % Math.max(2, Math.floor(n / 2))}`;
}
function stepsUpTo(s: Snapshot): Step[] {
  return s.plan.steps.filter((st) => st.t <= s.el);
}
function costSum(s: Snapshot): number {
  return round4(stepsUpTo(s).reduce((a, st) => a + st.cost, 0));
}

function usageSummary(s: Snapshot) {
  const st = stepsUpTo(s);
  const sum = (f: (x: Step) => number) => st.reduce((a, x) => a + f(x), 0);
  return {
    n_calls: st.length,
    input_tokens: sum((x) => x.input_tokens),
    output_tokens: sum((x) => x.output_tokens),
    cache_read: sum((x) => x.cache_read),
    cache_write: sum((x) => x.cache_write),
    cost_usd: costSum(s),
  };
}
function stateCounts(s: Snapshot): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of visibleHyps(s)) {
    const st = hypState(s, h);
    out[st] = (out[st] || 0) + 1;
  }
  return out;
}
function metricsOf(s: Snapshot): Metrics {
  const u = usageSummary(s);
  const hs = stateCounts(s);
  const nMatches = s.plan.matches.filter((m) => m.t <= s.el).length;
  const cacheTotal = u.cache_read + u.cache_write;
  const denom = u.input_tokens + cacheTotal;
  const get = (k: string) => hs[k] || 0;
  return {
    ...u,
    n_matches: nMatches,
    n_invalid_matches: 0,
    n_hypotheses: Object.values(hs).reduce((a, b) => a + b, 0),
    n_in_tournament: get("in_tournament") + get("pinned"),
    n_reviewed: get("reviewed") + get("in_tournament") + get("pinned"),
    n_pinned: get("pinned"),
    n_rejected: get("rejected"),
    cache_hit_ratio: denom ? u.cache_read / denom : null,
  };
}

function sessionRow(s: Snapshot): SessionRow {
  const vis = visibleHyps(s);
  const elos = vis.map((h) => currentElo(s, h)).filter((e): e is number => e != null);
  const cost = costSum(s);
  const u = usageSummary(s);
  return {
    id: s.rec.id,
    status: s.status,
    research_goal: s.rec.goal,
    created_at: new Date(s.rec.created_ms).toISOString(),
    updated_at: isoAt(s.rec, s.el),
    budget_usd: s.rec.budget_usd ?? round4(cost),
    budget_used_usd: cost,
    budget_tokens: s.rec.budget_tokens ?? DEFAULT_BUDGET_TOKENS,
    // Cap the gauge at the per-session util target (90-99%): incidental
    // match/review/finalize tokens always overshoot it, so a finished run reads
    // exactly its varied target rather than pinning at a fixed value.
    budget_used_tokens: Math.min(
      u.input_tokens + u.output_tokens || Math.round(cost * TOKENS_PER_USD),
      Math.floor((s.rec.budget_tokens ?? DEFAULT_BUDGET_TOKENS) * s.plan.utilTarget)),
    wall_clock_seconds: s.rec.wall_clock_seconds ?? DEFAULT_WALL_CLOCK_SECONDS,
    final_overview: s.status === "done" ? `artifacts/${s.rec.id}/final/overview.md` : null,
    n_hyps: vis.length,
    n_tournament: vis.filter((h) => hypState(s, h) === "in_tournament").length,
    top_elo: elos.length ? Math.max(...elos) : null,
    n_matches: s.plan.matches.filter((m) => m.t <= s.el).length,
    origin_session_id: s.rec.origin_session_id ?? null,
  };
}

function toHypothesis(s: Snapshot, h: PlanHyp): Hypothesis {
  const reviewed = h.tReview <= s.el;
  return {
    id: h.id,
    session_id: s.rec.id,
    created_at: isoAt(s.rec, h.tCreate),
    created_by: h.created_by,
    strategy: h.strategy,
    parent_ids: h.parents,
    title: h.title,
    summary: h.summary,
    full_text: h.full_text,
    elo: currentElo(s, h),
    matches_played: matchesPlayed(s, h),
    state: hypState(s, h),
    dedup_cluster: clusterId(h.idx, s.rec.n_initial),
    n_reviews: reviewed ? 1 : 0,
    scores: reviewed ? h.review.scores : {},
  };
}

/* ── Persistence ───────────────────────────────────────────── */
/** Current maximum budget preset (Deep). Legacy records persisted caps from the
 *  old presets (20M Standard / 150M Deep); clamp on load so their cards read
 *  sanely — usage is derived downstream, so the percentage stays consistent. */
const MAX_BUDGET_TOKENS = 5_000_000;
function loadRecords(): SimRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((r: SimRecord) => ({
      ...r,
      budget_tokens: Math.min(r.budget_tokens || DEFAULT_BUDGET_TOKENS, MAX_BUDGET_TOKENS),
    }));
  } catch { return []; }
}
function saveRecords(recs: SimRecord[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(recs)); } catch { /* quota — ignore */ }
}
function getRecord(id: string): SimRecord | null {
  return loadRecords().find((r) => r.id === id) ?? null;
}
function patchRecord(id: string, patch: Partial<SimRecord>): SimRecord | null {
  const recs = loadRecords();
  const i = recs.findIndex((r) => r.id === id);
  if (i < 0) return null;
  recs[i] = { ...recs[i], ...patch };
  saveRecords(recs);
  return recs[i];
}

/* ── Public API (consumed by api.ts / hooks.ts) ────────────── */
export function isSimSession(id: string | undefined): boolean {
  return !!id && id.startsWith("sim_");
}

export function createSimSession(input: {
  goal: string; budget_tokens: number; wall_clock_seconds: number; n_initial: number; speed?: number;
  origin_session_id?: string | null;
}): string {
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  const id = `sim_${Date.now().toString(36)}${rand}`;
  const n_initial = Math.max(2, Math.min(input.n_initial, 50));
  // A real LLM provider is available only when a credential is baked in (Groq
  // key or Pollinations token) — browsers can't call these anonymously. Without
  // one, we go straight to the prompt-aware template (which still reflects the
  // prompt), no pointless "generating" wait.
  const live = hasRealProvider();
  const rec: SimRecord = {
    id,
    goal: input.goal,
    budget_tokens: input.budget_tokens > 0 ? input.budget_tokens : DEFAULT_BUDGET_TOKENS,
    wall_clock_seconds: input.wall_clock_seconds > 0 ? input.wall_clock_seconds : DEFAULT_WALL_CLOCK_SECONDS,
    n_initial,
    speed: input.speed && input.speed > 0 ? input.speed : 0.5,
    created_ms: Date.now(),
    pausedAccumMs: 0,
    pauseStartedMs: null,
    status: "running",
    frozenSimSec: null,
    origin_session_id: input.origin_session_id ?? null,
    feedback: [],
    stateOverrides: {},
    mode: live ? "groq" : "sim",
    generating: live,
  };
  saveRecords([rec, ...loadRecords()]);

  if (live) {
    // Generate against the real model, bounded by a hard timeout. generateSession
    // resolves-always (prompt-aware template on any live failure), so the only
    // rejection path is this abort → still degrades to the template.
    _inFlight.add(id);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GEN_TIMEOUT_MS);
    // ponytail: cap the live request at 20 — a single 6k-token completion
    // (groq.ts max_tokens) can't hold ~50 hypotheses of JSON; indices beyond
    // the live content fall back per-index to the prompt-aware template.
    // Chunked multi-call generation if fully-live Deep runs ever matter.
    generateSession(input.goal, Math.min(n_initial + 2, 20), ctrl.signal)
      .then((content) => finishGenerating(id, content))
      .catch(() => finishGenerating(id, undefined))
      .finally(() => { clearTimeout(timer); _inFlight.delete(id); });
  }
  return id;
}

/** Land generated content (or degrade to template) and reset the sim clock to
 *  t=0. Re-anchors pause bookkeeping to the new origin so a pause taken during
 *  the "Reading your prompt…" window can't corrupt elapsed-time math. */
function finishGenerating(id: string, content: GeneratedContent | undefined): void {
  const now = Date.now();
  const rec = getRecord(id);
  const paused = rec?.status === "paused";
  patchRecord(id, {
    ...(content ? { content } : {}),
    generating: false,
    created_ms: now,
    pausedAccumMs: 0,
    pauseStartedMs: paused ? now : null,
  });
}

export function simListSessions(): SessionRow[] {
  return loadRecords()
    .map((rec) => sessionRow(snapshot(rec)))
    .sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at));
}

export function simStats() {
  const rows = simListSessions();
  return {
    n_sessions: rows.length,
    n_hypotheses: rows.reduce((a, r) => a + r.n_hyps, 0),
    n_matches: rows.reduce((a, r) => a + r.n_matches, 0),
    total_cost_usd: round4(rows.reduce((a, r) => a + r.budget_used_usd, 0)),
    running: rows.filter((r) => r.status === "running").length,
    done: rows.filter((r) => r.status === "done").length,
  };
}

export function simDetail(id: string): SessionDetail {
  const rec = mustRecord(id);
  const s = snapshot(rec);
  const row = sessionRow(s);
  return {
    session: {
      ...row,
      research_plan: makePlan(rec.goal),
      config_snapshot: { llm: { provider: "groq" }, simulated: true, model: SIM_MODEL },
    },
    metrics: metricsOf(s),
    counts: { hypothesis_states: stateCounts(s), task_status: {} },
    live: s.status === "running",
  };
}

export function simHypotheses(id: string): Hypothesis[] {
  const s = snapshot(mustRecord(id));
  return visibleHyps(s)
    .map((h) => toHypothesis(s, h))
    .sort((a, b) => {
      if ((a.elo == null) !== (b.elo == null)) return a.elo == null ? 1 : -1;
      return (b.elo ?? 0) - (a.elo ?? 0);
    });
}

export function simHypothesis(id: string, hid: string): Hypothesis {
  const s = snapshot(mustRecord(id));
  const h = s.plan.hyps.find((x) => x.id === hid);
  if (!h || h.tCreate > s.el) throw new Error("hypothesis not found");
  const base = toHypothesis(s, h);
  const reviewed = h.tReview <= s.el;
  const reviews = reviewed ? [{
    id: `rev_${h.id}`, kind: "full", verdict: h.review.verdict, ...h.review.scores,
    body: h.review.body, created_at: isoAt(s.rec, h.tReview),
  }] : [];
  const eloHist: { t: string; elo: number }[] = [];
  for (const m of s.plan.matches) {
    if (m.t > s.el) break;
    if (m.hyp_a === hid) eloHist.push({ t: isoAt(s.rec, m.t), elo: m.elo_a_after });
    else if (m.hyp_b === hid) eloHist.push({ t: isoAt(s.rec, m.t), elo: m.elo_b_after });
  }
  return { ...base, citations: h.citations, reviews: reviews as any, elo_history: eloHist };
}

export function simMatches(id: string): Match[] {
  const s = snapshot(mustRecord(id));
  const titleOf = (hid: string) => s.plan.hyps.find((h) => h.id === hid)?.title;
  return s.plan.matches
    .filter((m) => m.t <= s.el)
    .map((m) => ({
      id: m.id, created_at: isoAt(s.rec, m.t), hyp_a: m.hyp_a, hyp_b: m.hyp_b,
      mode: m.mode, winner: m.winner,
      elo_a_before: m.elo_a_before, elo_b_before: m.elo_b_before,
      elo_a_after: m.elo_a_after, elo_b_after: m.elo_b_after,
      rationale: m.rationale, similarity: m.similarity,
      title_a: titleOf(m.hyp_a), title_b: titleOf(m.hyp_b),
    }))
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
}

export function simCost(id: string): { by_agent: CostByAgent[]; summary: any } {
  const s = snapshot(mustRecord(id));
  const st = stepsUpTo(s);
  const byAgent = new Map<string, CostByAgent>();
  for (const x of st) {
    const cur = byAgent.get(x.agent) ?? { agent: x.agent, n_calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    cur.n_calls += 1;
    cur.input_tokens += x.input_tokens;
    cur.output_tokens += x.output_tokens;
    cur.cost_usd = round4(cur.cost_usd + x.cost);
    byAgent.set(x.agent, cur);
  }
  const by_agent = [...byAgent.values()].sort((a, b) => b.cost_usd - a.cost_usd);
  return { by_agent, summary: usageSummary(s) };
}

export function simFeedback(id: string): Feedback[] {
  const s = snapshot(mustRecord(id));
  const out = [...s.rec.feedback];
  // Self-critique rounds + the stress-test stage surface progressively as the
  // run reaches each timed row.
  for (const c of s.plan.critiques) if (c.t <= s.el) out.push(c.fb);
  for (const c of s.plan.stress) if (c.t <= s.el) out.push(c.fb);
  if (s.status === "done") out.push(s.plan.metaFeedback);
  return out.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
}

export function simLineage(id: string): { nodes: LineageNode[]; edges: { source: string; target: string }[] } {
  const s = snapshot(mustRecord(id));
  const vis = visibleHyps(s);
  const ids = new Set(vis.map((h) => h.id));
  const nodes: LineageNode[] = vis.map((h) => ({
    id: h.id, title: h.title, strategy: h.strategy, created_by: h.created_by,
    elo: currentElo(s, h), state: hypState(s, h), n_parents: h.parents.length,
  }));
  const edges: { source: string; target: string }[] = [];
  for (const h of vis) for (const p of h.parents) if (ids.has(p)) edges.push({ source: p, target: h.id });
  return { nodes, edges };
}

export function simClusters(id: string): ClusterPoint[] {
  const s = snapshot(mustRecord(id));
  const vis = visibleHyps(s);
  const clusterIds = [...new Set(vis.map((h) => clusterId(h.idx, s.rec.n_initial)))].sort();
  const centers = new Map<string, [number, number]>();
  const n = Math.max(clusterIds.length, 1);
  clusterIds.forEach((c, i) => {
    const ang = (2 * Math.PI * i) / n;
    centers.set(c, [Math.cos(ang) * 0.62, Math.sin(ang) * 0.62]);
  });
  return vis.map((h) => {
    const c = clusterId(h.idx, s.rec.n_initial);
    const [cx, cy] = centers.get(c)!;
    const jr = makeRng(h.id);
    return {
      id: h.id, title: h.title, strategy: h.strategy, elo: currentElo(s, h),
      state: hypState(s, h), cluster: c, matches_played: matchesPlayed(s, h),
      x: cx + (jr.random() - 0.5) * 0.34, y: cy + (jr.random() - 0.5) * 0.34,
    };
  });
}

export function simEloHistory(id: string): Record<string, { i: number; elo: number }[]> {
  const s = snapshot(mustRecord(id));
  const out: Record<string, { i: number; elo: number }[]> = {};
  let i = 0;
  for (const m of s.plan.matches) {
    if (m.t > s.el) break;
    (out[m.hyp_a] ||= []).push({ i, elo: m.elo_a_after });
    (out[m.hyp_b] ||= []).push({ i, elo: m.elo_b_after });
    i++;
  }
  return out;
}

export function simOverview(id: string): string {
  const s = snapshot(mustRecord(id));
  if (s.status !== "done") throw new Error("no overview yet");
  return s.plan.overview;
}

export function simEvents(id: string): SSEvent[] {
  const s = snapshot(mustRecord(id));
  return s.plan.events
    .filter((e) => e.t <= s.el)
    .map((e, i) => ({
      id: i + 1, ts: s.rec.created_ms + e.t * safeSpeed(s.rec) * 1000,
      agent: e.agent, event: e.event, payload: e.payload,
    }));
}

export function simTick(id: string): LiveTick {
  const s = snapshot(mustRecord(id));
  return {
    metrics: metricsOf(s),
    status: s.status,
    budget_used_usd: costSum(s),
    live: s.status === "running",
  };
}

export function simControl(id: string, action: "pause" | "resume" | "abort"): { status: string } {
  const rec = mustRecord(id);
  const now = Date.now();
  if (action === "pause" && rec.status === "running") {
    patchRecord(id, { status: "paused", pauseStartedMs: now });
    return { status: "paused" };
  }
  if (action === "resume" && rec.status === "paused") {
    const pausedAdd = rec.pauseStartedMs != null ? now - rec.pauseStartedMs : 0;
    patchRecord(id, { status: "running", pauseStartedMs: null, pausedAccumMs: rec.pausedAccumMs + pausedAdd });
    return { status: "running" };
  }
  if (action === "abort") {
    const el = elapsedSimSec(rec, now);
    patchRecord(id, { status: "aborted", frozenSimSec: el, pauseStartedMs: null });
    return { status: "aborted" };
  }
  return { status: rec.status };
}

export function simSendFeedback(id: string, body: { text: string; kind?: string; target_id?: string }): { ok: boolean } {
  const rec = mustRecord(id);
  const kind = body.kind || "directive";
  const fb: Feedback = {
    id: `fb_${id}_${rec.feedback.length}`, created_at: new Date().toISOString(),
    source: "human", kind, target_id: body.target_id || null, text: body.text, active: 1,
  };
  const overrides = { ...rec.stateOverrides };
  if (kind === "pin" && body.target_id) overrides[body.target_id] = "pinned";
  if (kind === "rejection" && body.target_id) overrides[body.target_id] = "rejected";
  patchRecord(id, { feedback: [...rec.feedback, fb], stateOverrides: overrides });
  return { ok: true };
}

export function simSetHypState(id: string, hid: string, state: string): { ok: boolean } {
  const rec = mustRecord(id);
  patchRecord(id, { stateOverrides: { ...rec.stateOverrides, [hid]: state as Hypothesis["state"] } });
  return { ok: true };
}

/** Build a top-5 leaderboard markdown answer grounded in current sim state. */
function answerFromData(id: string): string {
  const hyps = simHypotheses(id).filter((h) => h.elo != null);
  if (hyps.length === 0) {
    return (
      "The run just started, so there are no ranked hypotheses to discuss yet. " +
      "Give the tournament a few seconds and ask again."
    );
  }
  const top = hyps.slice(0, 5);
  const rows = top
    .map((h) => `| \`${h.id}\` | ${h.elo != null ? Math.round(h.elo) : "—"} | ${h.state} | ${(h.title || "").replace(/\|/g, "\\|")} |`)
    .join("\n");
  const lead = top[0];
  return [
    `Here are the current top ${top.length} hypotheses for this session, ranked by tournament Elo:`,
    "",
    "| id | Elo | state | title |",
    "|----|-----|-------|-------|",
    rows,
    "",
    `The current leader is **${lead.title}** (\`${lead.id}\`, Elo ${lead.elo != null ? Math.round(lead.elo) : "—"}). ${lead.summary || ""}`.trim(),
  ].join("\n");
}

export function simChat(id: string, message: string): {
  reply_markdown: string; intent: string; new_session_id: string | null;
} {
  const rec = mustRecord(id);
  const msg = message.trim();
  const intent = classifyIntent(msg);
  let reply: string;
  let newSid: string | null = null;

  if (intent === "out_of_scope") {
    reply = OUT_OF_SCOPE;
  } else if (intent === "tweak") {
    const hyps = simHypotheses(id);
    const top = hyps[0];
    const idea = top ? `${top.title}${top.summary ? ` — ${top.summary}` : ""}` : rec.goal;
    const goal = composeRerunGoal(idea, msg);
    newSid = createSimSession({
      goal, budget_tokens: rec.budget_tokens ?? DEFAULT_BUDGET_TOKENS,
      wall_clock_seconds: rec.wall_clock_seconds ?? DEFAULT_WALL_CLOCK_SECONDS,
      n_initial: rec.n_initial, speed: rec.speed,
      // Chains collapse to one root: child.origin = parent.origin ?? parent.id.
      origin_session_id: rec.origin_session_id ?? id,
    });
    reply = "Started a new research run based on your change.";
  } else {
    reply = answerFromData(id);
  }

  const now = new Date().toISOString();
  const chat = [...(rec.chat ?? []),
    { role: "user" as const, text: msg, created_at: now },
    { role: "assistant" as const, text: reply, intent, new_session_id: newSid, created_at: now },
  ];
  patchRecord(id, { chat });
  return { reply_markdown: reply, intent, new_session_id: newSid };
}

export function simChatHistory(id: string): ChatMsg[] {
  return mustRecord(id).chat ?? [];
}

function mustRecord(id: string): SimRecord {
  const rec = getRecord(id);
  if (!rec) throw new Error("session not found");
  return rec;
}
