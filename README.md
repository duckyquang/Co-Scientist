<div align="center">

# 🧬 Co-Scientist

**A multi-agent research engine that turns a natural-language goal into tournament-ranked hypotheses.**

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11--3.13-blue.svg)](https://www.python.org/)
[![Live Demo](https://img.shields.io/badge/demo-GitHub%20Pages-6366f1.svg)](https://duckyquang.github.io/Co-Scientist/)

*Created by **Quang Bui***

</div>

---

An open-source re-implementation of Google's **AI co-scientist** ([Gottweis et al., *Nature*, 2026](https://www.nature.com/articles/s41586-026-10644-y); [research blog](https://research.google/blog/accelerating-scientific-breakthroughs-with-an-ai-co-scientist/)) — a multi-agent system that takes a research goal and produces a tournament-ranked **research overview** of novel hypotheses.

> Independent project — not affiliated with Google or the paper's authors.

---

## ✨ Highlights

| | |
|---|---|
| **6 specialized agents** | Generation, Reflection, Ranking, Evolution, Proximity, Meta-review |
| **Elo tournament** | Pairwise debates rank hypotheses into a live leaderboard |
| **Provider-agnostic** | Anthropic, OpenAI, OpenRouter, Gemini, Groq, Ollama, and more |
| **Live web UI** | React dashboard with SSE streaming, lineage graphs, cluster maps |
| **Key-free demo** | Explore pre-seeded sessions without API keys |

---

## 🌐 Live demo

Browse sample research sessions on GitHub Pages — no setup required:

**[https://duckyquang.github.io/Co-Scientist/](https://duckyquang.github.io/Co-Scientist/)**

The live demo is a read-only snapshot. Run locally to create new sessions.

---

## 🚀 Quick start

### 1. Install

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

cp .env.example .env
# Add your LLM provider API key
```

### 2. Initialize

```bash
co-scientist init
co-scientist list
```

### 3. Run a session

```bash
co-scientist run "Identify hypotheses about microbiome-driven inflammation" \
  --n 3 --budget-usd 2.0 --wall-clock 600
```

### 4. Launch the web UI

```bash
# Seed demo data + start the server
python -m webapp.seed --reset
python -m webapp.server --seed --port 8000

# In another terminal — dev frontend
cd frontend && npm install && npm run dev
```

Open **http://localhost:5173** (API proxied to port 8000).

---

## 🏗️ Architecture

```
                       co-scientist run "<goal>"
                                  │
                                  ▼
            ┌──────────────────────────────────────┐
            │            Supervisor                │  durable task queue (SQLite)
            │  • parse_goal → ResearchPlan         │  bounded concurrency
            │  • enqueue initial Generation tasks  │  lease + dead-letter + resume
            │  • main loop: claim → run → follow-up│  termination: BUDGET / WALL_CLOCK
            │  • decide_next_steps when idle       │              / ELO_STABLE / IDLE
            │  • finalize: meta-review overview    │
            └──────────────────────────────────────┘
                                  │  tasks
            ┌─────────────────────┼─────────────────────────────┐
            ▼                     ▼                             ▼
   ┌──────────────┐      ┌──────────────┐              ┌──────────────┐
   │  Generation  │ hyp  │  Reflection  │ review       │   Ranking    │
   │  literature  │─────►│  full +      │─────────────►│ pairwise vs  │──► Elo
   │  + debate    │      │  verification│              │   debate     │
   └──────────────┘      └──────────────┘              └──────────────┘
            ▲                     ▲                             │
            │                     │ informative pairings        ▼
   ┌──────────────┐      ┌──────────────┐              ┌──────────────┐
   │  Evolution   │◄─────│ Meta-review  │              │  Proximity   │
   │ combine /    │ feed │ system fdbk  │              │ FAISS embed  │
   │ simplify /   │ back │ + final      │              │ + cluster /  │
   │ feasibility /│      │ overview     │              │ dedup        │
   │ out_of_box   │      └──────────────┘              └──────────────┘
   └──────────────┘
            │
            ▼
       new hypotheses re-enter the cycle
```

### Agent roster

- **Generation** — proposes hypotheses via literature review and simulated scientific debate
- **Reflection** — reviews for novelty, correctness, and testability; deep-verifies assumptions
- **Ranking** — Elo tournament with simulated debates between hypotheses
- **Evolution** — combines, simplifies, reimagines top-ranked hypotheses
- **Proximity** — embeds and clusters hypotheses for dedup and informative pairings
- **Meta-review** — synthesizes system-wide feedback and the final research overview

Paper source materials used to instruct the build are in [`reference/`](reference/) (pseudocode, prompts, diagrams). Prompts are in [`config/prompts/`](config/prompts/).

---

## ⚙️ Configuration

Layered config: [`config/default.toml`](config/default.toml) → `~/.co-scientist/config.toml` → `./co-scientist.toml` → `--config <path>`

```toml
[llm]
provider = "openai"   # anthropic | openai | openrouter | gemini | groq | ollama | ...

[models]
generation       = "<strong-model>"
reflection       = "<strong-model>"
ranking_pairwise = "<cheap-model>"
# ... override ALL keys when switching providers
```

| Provider | API key env var | Example models |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-opus-4-7`, `claude-sonnet-4-6` |
| `openai` | `OPENAI_API_KEY` | `gpt-5`, `gpt-4o`, `o3-mini` |
| `openrouter` | `OPENROUTER_API_KEY` | `openai/gpt-5`, `google/gemini-2.5-pro` |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.5-pro`, `gemini-2.5-flash` |
| `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| `ollama` | *(none)* | `llama3.3:70b` |

Tool / function calling is **required**. See the full provider table and feature matrix in the original docs above or [`config/default.toml`](config/default.toml).

---

## 🖥️ CLI reference

```bash
co-scientist serve            # FastAPI + htmx + SSE dashboard at localhost:7878
co-scientist report <id>      # print the final overview
co-scientist status <id>      # session metadata + counts
co-scientist pause <id> | resume <id> | abort <id>
co-scientist feedback <id> --kind directive --text "focus on metabolic pathways"
co-scientist estimate         # pre-flight cost estimate
co-scientist eval [agent]     # run the rubric eval bundle
co-scientist tools list       # show registered agent tools
co-scientist bench --preset paper   # cross-model head-to-head comparison
```

Bench results: [`docs/BENCH_RESULTS.md`](docs/BENCH_RESULTS.md) (auto-generated via `python scripts/build_bench_report.py`).

---

## 📦 Repository layout

```
co_scientist/     # Python engine — agents, LLM, storage, tools, vectors
config/           # default.toml + Jinja2 agent prompts
frontend/         # React + Vite web dashboard
webapp/           # Stdlib HTTP server + demo seeder + simulator
scripts/          # bench report builder, static demo exporter
docs/             # BENCH_RESULTS.md
reference/        # paper source materials (gitignored)
data/             # runtime artifacts (gitignored)
```

---

## 🚢 Deploy to GitHub Pages

The frontend deploys automatically on push to `main` via [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).

Manual build:

```bash
python scripts/export_static_demo.py
cd frontend
GITHUB_PAGES=true VITE_STATIC_DEMO=true npm run build:pages
```

Enable **GitHub Pages → Source: GitHub Actions** in your repo settings.

---

## 📄 License

Apache-2.0 — see [LICENSE](LICENSE).
