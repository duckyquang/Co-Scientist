export type SessionStatus = "running" | "paused" | "done" | "failed" | "aborted";

export interface SessionRow {
  id: string;
  status: SessionStatus;
  research_goal: string;
  created_at: string;
  updated_at: string;
  budget_usd: number;
  budget_used_usd: number;
  budget_tokens: number;
  budget_used_tokens: number;
  wall_clock_seconds?: number;
  final_overview: string | null;
  n_hyps: number;
  n_tournament: number;
  top_elo: number | null;
  n_matches: number;
  /** Root of this session's rerun chain (chat "tweak" spawns); null/absent = own root. */
  origin_session_id?: string | null;
}

export interface ResearchPlan {
  objective: string;
  preferences: string[];
  constraints: string[];
  idea_attributes: string[];
  domain_hint?: string | null;
  notes?: string | null;
}

export interface SessionDetail {
  session: SessionRow & {
    research_plan: ResearchPlan;
    config_snapshot: any;
  };
  metrics: Metrics;
  counts: {
    hypothesis_states: Record<string, number>;
    task_status: Record<string, number>;
  };
  live: boolean;
}

export interface Metrics {
  n_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_write: number;
  cost_usd: number;
  n_matches: number;
  n_invalid_matches: number;
  n_hypotheses: number;
  n_in_tournament: number;
  n_reviewed: number;
  n_pinned: number;
  n_rejected: number;
  cache_hit_ratio: number | null;
}

export type HypState =
  | "draft" | "reviewed" | "in_tournament" | "pinned"
  | "rejected" | "quarantined" | "retired";

export interface Scores {
  novelty?: number | null;
  correctness?: number | null;
  testability?: number | null;
  feasibility?: number | null;
}

export interface Hypothesis {
  id: string;
  session_id: string;
  created_at: string;
  created_by: "generation" | "evolution";
  strategy: string;
  parent_ids: string[];
  title: string;
  summary: string;
  full_text: string;
  elo: number | null;
  matches_played: number;
  state: HypState;
  dedup_cluster: string | null;
  n_reviews?: number;
  scores: Scores;
  citations?: Citation[];
  reviews?: Review[];
  elo_history?: { t: string; elo: number }[];
  /** Varied synthetic reasoning for sim hyps (labelled SIMULATED in the UI); the
   *  model's real rationale for BYOK/Groq hyps. Optional — populated by the sim
   *  engine. */
  thinking?: string;
}

export interface Citation {
  title: string;
  url: string;
  excerpt: string | null;
  doi: string | null;
  year: number | null;
}

export interface Review {
  id: string;
  kind: string;
  verdict: string | null;
  novelty: number | null;
  correctness: number | null;
  testability: number | null;
  feasibility: number | null;
  body: string;
  created_at: string;
}

export interface Match {
  id: string;
  created_at: string;
  hyp_a: string;
  hyp_b: string;
  mode: string;
  winner: "a" | "b" | null;
  elo_a_before: number;
  elo_b_before: number;
  elo_a_after: number | null;
  elo_b_after: number | null;
  rationale: string | null;
  similarity: number | null;
  title_a?: string;
  title_b?: string;
}

export interface Feedback {
  id: string;
  created_at: string;
  source: string;
  kind: string;
  target_id: string | null;
  text: string;
  active: number;
}

export interface CostByAgent {
  agent: string;
  n_calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface LineageNode {
  id: string;
  title: string;
  strategy: string;
  created_by: string;
  elo: number | null;
  state: HypState;
  n_parents: number;
}

export interface ClusterPoint {
  id: string;
  title: string;
  strategy: string;
  elo: number | null;
  state: HypState;
  cluster: string;
  matches_played: number;
  x: number;
  y: number;
}

export interface SSEvent {
  id: number;
  ts: number;
  agent: string | null;
  event: string;
  payload: any;
}

export interface Meta {
  demo_mode: boolean;
  static_demo?: boolean;
  hosted?: boolean;
  server_has_key?: boolean;
  requires_api_key?: boolean;
  readme_local_url?: string;
  providers: { id: string; label: string; models: string[] }[];
  models: Record<string, string>;
  defaults: { budget_usd: number; n_initial: number; wall_clock_seconds: number };
}

/** A run-effort preset shown on the New Session screen. */
export interface RunPreset {
  id: "quick" | "standard" | "deep";
  label: string;
  blurb: string;
  budget_tokens: number;
  wall_clock_seconds: number;
  n_initial: number;
}

// budget_tokens is the hard cap AND the target: the engine keeps refining
// (tournaments, evolution, recurring self-critique) until >=95% of it is
// consumed, so a preset's budget is roughly what a run will actually spend.
export const RUN_PRESETS: RunPreset[] = [
  {
    id: "quick", label: "Quick", blurb: "A fast first pass — 5 hypotheses, a short tournament.",
    budget_tokens: 1_000_000, wall_clock_seconds: 3600, n_initial: 5,
  },
  {
    id: "standard", label: "Standard", blurb: "A balanced run — 15 hypotheses, deeper ranking.",
    budget_tokens: 2_000_000, wall_clock_seconds: 10800, n_initial: 15,
  },
  {
    id: "deep", label: "Deep", blurb: "An exhaustive search — 50 hypotheses and evolution rounds.",
    budget_tokens: 5_000_000, wall_clock_seconds: 21600, n_initial: 50,
  },
];

export interface GlobalStats {
  n_sessions: number;
  n_hypotheses: number;
  n_matches: number;
  total_cost_usd: number;
  running: number;
  done: number;
}
