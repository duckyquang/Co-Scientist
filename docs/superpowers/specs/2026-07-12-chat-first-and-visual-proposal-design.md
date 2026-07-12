# Chat-first experience + visual proposal — design

Date: 2026-07-12

Two workstreams that share one renderer change. Per the approved rollout,
**workstream 2 (visual proposal + export) ships first**, then workstream 1
(chat thread).

## Decisions (approved)

- **Power views:** thread is primary; a single **Explore** drawer reuses the
  existing interactive views (leaderboard / tournament / lineage / clusters /
  analytics) wholesale.
- **Proposal charts:** full set — reuse existing SVG charts (scorecard, Elo,
  clusters) **plus Mermaid** for the lineage diagram.
- **PDF:** browser **print-to-PDF** with a print stylesheet (zero deps, vector
  charts, selectable text).
- **Rollout:** visual proposal + export first, then the chat redesign.
- **Markdown, not LaTeX:** the report stays one markdown string (copy = verbatim
  clipboard write); math renders via **KaTeX**. No TeX engine, no LaTeX rewrite.

## Workstream 2 — visual, exportable proposal (building now)

### Renderer
Replace `marked` + `dangerouslySetInnerHTML` in `frontend/src/components/ui.tsx`
(`Markdown`) with **react-markdown + remark-gfm + remark-math + rehype-katex**.
A `components` map upgrades fenced blocks:
- ` ```mermaid ` → `<Mermaid>` (mermaid.js, theme-aware).
- ` ```chart ` → `<ReportChart spec={JSON}>` reusing existing SVG chart
  primitives (`Donut`, `ScoreBars`, `Sparkline`/`EloRace`).
- everything else keeps `.prose-sci` styling (extended with table + katex rules).

Import `katex/dist/katex.min.css` once in `main.tsx`. KaTeX renders
synchronously (no stream reflow), fully covers this tool's notation (Elo update,
p-values, thresholds).

### Report content — single markdown string, chart blocks + tables
The report body stays qualitative prose; a deterministic **Analysis** section is
assembled by code from real data so charts are always present and correct
regardless of the LLM:
- **Proposal scorecard** — novelty/correctness/testability/feasibility across the
  top proposals: a markdown **table** (copy) + a ` ```chart ` bar/radar (screen).
- **Elo trajectory** of finalists — table + sparkline/Elo-race.
- **Theme distribution** (clusters) — table + donut.
- **Lineage** — a ` ```mermaid ` graph (renders on-site and natively on
  GitHub/Notion when pasted).
- **Elo formula** — KaTeX `$$…$$`.

Assembled in three mirrored places (they already diverge by layer):
- Sim (default demo): `frontend/src/lib/sim/content.ts:makeOverview` — receives
  richer per-proposal data (scores, elo) from `engine.ts`.
- Demo server: `webapp/content.py:make_overview`.
- Real backend: `co_scientist/agents/metareview.py` appends a deterministic
  figures section after the LLM prose; `config/prompts/metareview_final.md`
  also asks for inline tables.

Copy-as-markdown already exists (`OverviewPanel` Copy button → `writeText(md)`),
kept verbatim so charts degrade to tables/mermaid/latex source.

### PDF
`OverviewPanel` Print/PDF button already calls `window.print()`. Add a print
stylesheet (`@media print`) in `index.css`: hide app chrome (sidebar, composer,
buttons), `@page { size: A4; margin: 18mm }`, `break-inside: avoid` on chart
blocks/tables/section cards, and force light-theme tokens so dark reports print
readable. Charts are on-screen SVG → printed as vectors.

### New deps
`react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex`, `katex`,
`mermaid`.

## Workstream 1 — chat-first experience (next pass)

- **Landing:** centered composer (greeting, prompt bar, suggested-goal chips,
  Quick/Standard/Deep effort control); sidebar Recent = conversation history.
- **Transition:** on submit the composer docks to the bottom (CSS flex
  `justify-center → justify-end`), the goal shows as a user message, work streams
  above.
- **Live thread:** chronological assistant messages grouped into collapsible
  phases (Understanding → Generating → Reviewing → Ranking → Evolving → Proposal).
  Charts render **inside** the message where they aid the point. The ranking
  message **updates in place** (stable key). Perplexity-style collapsible step
  rows. Stick-to-bottom only when already at bottom (IntersectionObserver, ~15
  lines). No new streaming lib.
- **Explore drawer:** one affordance opens the existing interactive views.
- **Composer stays docked:** sends steering feedback during a run (existing
  feedback system), follow-ups after.
- **Sessions = conversations:** clicking a Recent item replays the thread from
  stored events + data.
- **Fidelity note:** the in-browser sim emits fine-grained
  `hypothesis_created` / `match_complete` events (rich animation); the real
  backend narrates at phase granularity + data polling. Adding per-item events to
  the Python backend is a follow-up, not a blocker.

Host file: `frontend/src/pages/Session.tsx` becomes the thread; `Dashboard`/`New
Session` fold into the landing composer.

## Out of scope

- Server-side Playwright PDF (escalation path only).
- A charting library (recharts/visx) — existing SVG charts + data suffice.
- Backend per-item event emission (workstream 1 follow-up).
