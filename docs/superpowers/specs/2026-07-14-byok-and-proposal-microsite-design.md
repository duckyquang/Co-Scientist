# Working BYO keys + proposal microsite — design

Date: 2026-07-14

## 1. Deployment mode + keys that actually work

**Problem (from code mapping).** The free in-browser demo runs its LLM calls
through `lib/llm` using a *build-time* Groq/Pollinations key only — it never reads
the user's pasted key (`getCredentials()`). And on the static demo, saving a key
flips `canUseLiveApi()` true, which routes `create()` to a POST that `apiUrl()`
rewrites to a static JSON file → it errors. Net: pasting your own key today
*breaks* the working sim and yields no real output.

**Changes.**
- Rename `DeploymentMode` `"local" | "cloud"` → `"default" | "byok"`; default =
  `"default"`. Migrate stored `"cloud"→"byok"`, `"local"→"default"`.
- `SettingsModal`: two options — **Free (default)** and **Your own API key**.
  Drop the `Local` toggle; keep a small self-host note + setup link in the Free
  panel. Provider dropdown defaults to Groq; note that only Groq runs
  in-browser (CORS), others need a hosted backend.
- `groq.ts:groqKey()` falls back to the user's pasted Groq key when no build-time
  key exists — because `hasGroqKey`/`activeProvider`/`hasRealProvider`/`chatJson`
  all route through it, this one change lights up the whole in-browser path.
- `live.ts:canUseLiveApi()`: drop the legacy `mode==='cloud' && creds` branch so a
  static-demo user with a key stays on the in-browser sim (their Groq key flows
  through `generate.ts → chatJson → groqJson`).
- `authHeaders()` emits `X-LLM-Provider`/`X-API-Key` when `mode==='byok'` + creds
  (hosted-backend path, unchanged behavior).
- Update `App.tsx ModeBadge` + `OnboardingModal` to the new mode values.

Constraint: BYO-in-browser is **Groq-only**; other providers require the
hosted/self-hosted backend (labeled in the UI).

## 2. Proposal → website (bold vibrant landing page)

**Delivery.** A **View as website** button beside Copy/Print in `OverviewPanel`
(uses `useParams()` for the id) links to a new route `/s/:id/site`.

**Microsite** (`pages/Microsite.tsx`): a `fixed inset-0 z-50` full-screen view
that re-fetches the cached `api.overview(id)` markdown and reuses the existing
`<Markdown>` renderer (charts/Mermaid/KaTeX come along), wrapped in a designed
shell:
- **Toolbar** (no-print): back, theme toggle, Print/PDF, copy link.
- **Hero**: gradient band, big title + research goal, a decorative inline-SVG
  illustration (abstract science network/particles), a few key stats.
- **Sticky table of contents** parsed from the markdown's `## ` headings.
- **Body**: the report rendered large, with colorful section bands and the data
  charts as feature figures.

**Style**: bold, vibrant, energetic — gradient hero, colored section accents,
punchy type. Self-contained (inline SVG, no external images), theme-aware
(`.dark` + CSS vars), printable (reuse `@media print`).

**Anchors**: add `h2`/`h3` id-slug overrides to the shared `Markdown` components
map (harmless, enables TOC anchor scroll) — no new dependency (no rehype-slug).

**Section headings** are stable from `content.ts:makeOverview` /
`metareview.py`: `# Research proposal`, `## Problem framing…`, `## Executive
summary`, `## The approach landscape`, `## Ranked proposals`, `## Comparative
assessment`, `## Recommended path…`, `## Open questions…`, `## Analysis`.

## Out of scope
- Non-Groq keys in-browser (CORS-blocked; hosted backend only).
- A downloadable standalone `.html` file (the route + Print/PDF covers sharing).
