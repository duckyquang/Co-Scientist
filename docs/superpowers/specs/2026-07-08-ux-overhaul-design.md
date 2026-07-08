# Co-Scientist UX overhaul — design

Date: 2026-07-08

## Goal

Co-Scientist works, but the results view is hard for a newcomer to read, the run
control asks for a dollar budget (which is meaningless since the app is free),
and the final report is too thin. This overhaul makes the tool legible: a
plain-language results summary, token/time run controls instead of dollars, a
detailed research-proposal report, and an OrbitAI-inspired blue+green dark
aesthetic.

## Key architectural fact

The real engine **already enforces a token cap (`budget_tokens`) and a run
duration (`wall_deadline` from `wall_clock_seconds`)** in
`co_scientist/orchestrator/termination.py`. Dollars are only *surfaced*, never
uniquely enforced at the session level. So the budget change is mostly surface
plumbing (API body, meta defaults, UI), not new engine logic.

The app has **three hand-mirrored data layers** speaking one `/api` contract:
1. Real FastAPI backend (`co_scientist/web/react_api.py`) running the actual agents.
2. In-browser simulator (`frontend/src/lib/sim/engine.ts` + `content.ts`) — the
   default zero-config free path for static deploys (`sim_` ids).
3. `webapp/` stdlib demo server + `webapp/simulator.py` + `webapp/content.py`,
   plus bundled static JSON exported by `scripts/export_static_demo.py`.

`co_scientist/web/react_api.py` imports `webapp.store`, so `store.py` backs the
real backend too. Any field/format change must move across the mirrored spots.

## Workstreams

### 1. Run controls — token cap + time, not dollars

- New Session: replace the `$` slider with three **preset cards** (Quick /
  Standard / Deep), each mapping to `(budget_tokens, wall_clock_seconds,
  n_initial)`, plus an "Advanced" expander for exact values.
- `CreateSessionBody` (react_api + webapp/server) accepts `budget_tokens` and
  `wall_clock_seconds`; maps to `cfg.run` (already enforced). `budget_usd` stays
  a column with its default — **no DB migration**. Cost keeps being tracked and
  is demoted to a small "est. cost" stat, never the limit.
- `/api/meta` defaults expose the preset tiers (token cap + minutes).
- Sim/webapp/`engine.ts`: drive the gauge and session-end off tokens + elapsed
  time (the sim already computes per-step input/output tokens); stop using the
  `220k tokens/$` derivation for the displayed limit.
- Session header: "Tokens used / cap" + "Time elapsed / limit" gauges.
  Dashboard cards + Analytics: token progress primary, `$` demoted.

### 2. Results view — plain-language Summary tab first

New default **Overview** tab:
- Plain headline: "N explored · M reached tournament · top idea: …".
- **Top 3 proposals** as readable cards (title, one-line why, Elo, first
  experiment) → click opens existing `HypothesisDrawer`.
- A **"Why these results"** explainer panel + a compact legend defining Elo /
  lineage / clusters.
- Final-report status.

Existing tabs kept behind Overview, reordered, de-noised. Dense metric strip →
fewer grouped stat-cards.

### 3. Lineage + clusters readability

- Lineage: human tier labels ("Original ideas" → "Evolved: round 1"), rank badge
  + Elo per node, ancestry highlighted only on hover, lighter edges.
- Clusters: short human theme names from the dominant strategy, a side legend,
  clearer "dot size = Elo, color = theme" key.

### 4. Detailed research-proposal report

Rewrite `config/prompts/metareview_final.md` into a structured proposal:
problem framing & significance → approach landscape → per top proposal
(hypothesis, mechanism, proposed experiment + readouts, feasibility & risks,
evidence) → comparative assessment → recommended path & sequencing → open
questions & falsification → references. Raise `max_output_tokens` 8192 → 16000
(`metareview.py`; thinking budget is already 16k). Mirror the structure in
`webapp/content.py:make_overview` and `frontend/src/lib/sim/content.ts:makeOverview`.
Report panel gets a table of contents + copy/print.

### 5. Aesthetic — blue primary + green accent

Add a green/teal accent token for "insight / converged / success" states, glowing
dot accents, softer rounded icon-cards for stats, explainer panels — keeping
near-black background and blue as the primary action color.

## Out of scope (deliberate)

- No migration to drop `budget_usd` columns (kept, hidden as the limit).
- Not fixing the racy session-create polling or the `live_sessions` completion
  leak surfaced during mapping (real bugs, separate work).
- Not touching the tournament / agent logic.

## Verification

Build the frontend, run the Vite dev server via preview tools, exercise New
Session → Overview → tabs in in-browser sim mode, capture screenshots. Run any
Python tests present.
