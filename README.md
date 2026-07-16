<div align="center">

# 🧬 Co-Scientist

**A multi-agent research engine that turns a one-line research goal into tournament-ranked, stress-tested, citation-grounded hypotheses.**

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11--3.13-blue.svg)](https://www.python.org/)
[![Live Demo](https://img.shields.io/badge/demo-live-3b82f6.svg)](https://duckyquang.github.io/Co-Scientist/)

*Created by **Quang Bui***

### [→ Try the live demo](https://duckyquang.github.io/Co-Scientist/) — no account, no API key

</div>

Type a research question. A team of specialised agents generate competing
hypotheses, debate and **Elo-rank** them, evolve the best across several rounds,
**adversarially stress-test the top 3**, then write a final proposal with inline
`[n]` citations grounded in real papers. Watch every step — including the agents'
reasoning — stream live in the chat.

- **Elo tournament** of pairwise hypothesis debates
- **Recurring self-critique** — the engine re-questions its own leaderboard for flaws and weak citations
- **Stress-testing the top 3** — contradicting-evidence search, citation verification, feasibility + a prototype-scale experiment, then fixes and a re-rank
- **Multi-round evolution** of the leading ideas
- **HIGH RISK mode** — a toggle for bold, contrarian, non-derivative hypotheses
- **Real citations, no key** — OpenAlex / PubMed / arXiv / Europe PMC, each verified, with a numbered `## References` section
- Runs in the browser with **no setup**, or self-host for a server-side key

---

## ✨ What it does

An open-source re-implementation of Google's **AI co-scientist**
([Gottweis et al., *"Accelerating scientific discovery with Co-Scientist,"* **Nature**, 2026](https://www.nature.com/articles/s41586-026-10644-y)).
Six specialised agents collaborate through an Elo tournament, then an adversarial
stress-test stage pressure-tests the finalists, to turn a natural-language goal
into a ranked, citation-grounded research proposal.

> Independent project — not affiliated with Google or the paper's authors.

**A single run walks through these stages** — all of it streaming live in the chat,
including the agents' own reasoning:

1. **Generate** competing hypotheses from a literature review and multi-agent debate.
2. **Reflect** — review each for novelty, correctness, and testability.
3. **Rank** in an **Elo tournament** of pairwise debates.
4. **Evolve** the leaderboard's best ideas across **multiple rounds** (combine, simplify, out-of-the-box) — shown as distinct steps.
5. **Self-critique**, recurring — the meta-review agent re-questions its own leaderboard: *are these really the best hypotheses? what are the flaws, the wrong conclusions, the suspect citations?* Its thinking shows in the feed.
6. **Stress-test the top 3** — *the headline stage.* Each finalist is adversarially probed: search for **contradicting evidence**, **verify every citation**, run a **feasibility check**, and design a **prototype-scale experiment**. Surviving weaknesses are **fixed**, then the finalists are **re-ranked** head-to-head.
7. **Meta-review** — synthesise the final proposal with inline `[n]` citations and a numbered `## References` section.

Steps 3–5 repeat each round until the leaderboard is stable or the token budget is
spent; step 6 runs once, at finalize.

### The six core agents

| Agent | Role |
|---|---|
| **Generation** | Proposes hypotheses via literature review and debate |
| **Reflection** | Reviews novelty, correctness, testability |
| **Ranking** | Elo tournament with pairwise debates |
| **Evolution** | Combines and refines top hypotheses across rounds |
| **Proximity** | Clusters hypotheses for dedup and matchmaking |
| **Meta-review** | Recurring self-critique and the final research overview |

A dedicated **stress-test** stage (config `[run] stress_test_top_k`, default 3)
runs the adversarial probe on the finalists at the end of a run.

### ⚡ HIGH RISK mode

Flip the **High risk** toggle on the composer to push every agent toward **bold,
contrarian, non-derivative** hypotheses instead of safe, incremental ones
(config `[run] high_risk`). Sessions run this way are badged so you can tell them
apart.

### 🎚️ Hypothesis modes

The landing composer's **Effort** picker has three modes controlling how many
parallel generation agents run (`RUN_PRESETS` in
[`frontend/src/types.ts`](frontend/src/types.ts); token budget and wall-clock
limit scale up with depth):

| Mode | Initial hypotheses | When to use |
|---|---|---|
| **Quick** | 5 | Fast sanity check of an idea |
| **Standard** *(default)* | 15 | Balanced breadth vs. runtime |
| **Deep** | 50 | Exhaustive exploration of a goal |

All three runtimes — the in-browser simulator, the `webapp` Python simulator,
and the real engine — accept up to 50 parallel hypotheses.

### 💬 Chat follow-ups

Every session is a chat thread. Follow-up messages
(`POST /api/sessions/{id}/chat`) are routed by intent:

- **Questions about the output** → a grounded answer with a compact table and
  hypothesis chips as illustrations.
- **Tweak / update / fix requests** → the engine reruns as a **new session**
  whose research goal is exactly:

  ```text
  ORIGINAL IDEA: {idea}

  FEEDBACK / CHANGE WANTED: {user input (extended, if necessary, by the agent)}

  Suggest a new method based on the original idea and the feedback / change wanted.
  ```

  The reply links to the new run.
- **Out-of-scope requests** → the reply "Currently, Co-Scientist is unable to
  do this."

To steer a session **while it's still running**, the feedback endpoint
(`POST /api/sessions/{id}/feedback`) still accepts directives, preferences,
and per-hypothesis pin/reject.

### 📚 Real citations, no key required

Agents ground their claims in real literature through four **keyless** public
APIs that are always on: `openalex_search`, `pubmed_search`, `arxiv_search`, and
`europe_pmc_search` — giving real papers with resolving DOIs out of the box.
General `web_search` auto-activates only when you supply a `TAVILY_API_KEY` or
`BRAVE_API_KEY`.

Every proposal ends with a numbered `## References` section, and inline `[n]`
markers throughout the text link to it. The real engine builds that list only
from papers actually fetched during literature search (`CitedPaper` records),
verifies each one, and marks any entry the citation verifier couldn't confirm as
`(unverified)`. Browser-run proposals — simulated or generated by an in-browser
LLM — include well-formed references too.

---

## 🚀 Quick start — no setup required

1. **Visit the live site** → [duckyquang.github.io/Co-Scientist](https://duckyquang.github.io/Co-Scientist/)
   — it opens on a landing page; click **Launch the demo** to reach the chat
   composer (`/chat`)
2. Pick an **Effort** — **Quick** (5), **Standard** (15, default), or **Deep**
   (50 initial hypotheses) — and optionally flip **High risk** on
3. Type your research question and send

**No account. No API key. No configuration** — for the visitor. Type a prompt and
the agents generate, debate, and Elo-rank hypotheses, evolve the best across
rounds, self-critique, and adversarially stress-test the top 3 — then write a
final proposal with §-numbered sections, inline `[n]` citations, and a
`## References` list, rendered visually with Mermaid diagrams, KaTeX math, and
charts. Every finished proposal also has a shareable microsite view
(**View as website**, `/s/<id>/site`) with print-to-PDF export. When it's done,
ask follow-up questions or request changes right in the session thread.

The UI is an academic "graph-paper" design inspired by
[GEML](https://saidlaboratory.github.io/GEML/): serif typography, mono
micro-labels, a paper-and-grid background, flat 1px-rule cards, and a
red/blue/green accent system. Light and dark follow your OS setting
(`prefers-color-scheme`) unless you flip the sidebar toggle, and the hypothesis
drawer slides in from the right.

**How the live site answers prompts** depends on the build (all knobs documented
in [`frontend/.env.example`](frontend/.env.example)):

- **Prompt-aware simulation (default, no setup).** With no credential, the site runs a
  clearly-labeled **in-browser simulation** that actually reads your prompt: it extracts
  the key terms, infers the domain (transport, energy, education, biomedicine, …), and
  generates **on-topic** hypotheses locally — nothing leaves your device. It reflects the
  prompt but isn't a live model's reasoning.
- **Live reasoning via a baked credential (recommended).** Add a free
  [Groq](https://console.groq.com/keys) key as a `GROQ_API_KEY` repo **secret** — the
  deploy workflow bakes it into the build (`VITE_GROQ_API_KEY`) and every prompt is
  answered for real by Llama 3.3 70B, with nothing for the visitor to enter. A registered
  [Pollinations](https://pollinations.ai) token (`VITE_POLLINATIONS_TOKEN`) works as a
  keyless-style alternative. ⚠️ A credential baked into a static site is publicly visible,
  so use a **free, rotatable** one you can revoke — never a paid key. (Browsers can't call
  these providers anonymously, which is why a baked credential enables live reasoning.)
- **Bring your own key.** Any visitor can switch **Settings → Your own API key** and
  paste a Groq key — it stays in the browser's `localStorage` and powers live in-browser
  reasoning on the spot (Groq only in-browser; other providers need a hosted backend).

> Prefer a server-side key (not exposed) and richer, web-search-grounded agents?
> [Self-host](#️-self-host-in-5-minutes) or point the site at your own backend via
> `VITE_API_URL`.

---

## 🏗️ Self-host in 5 minutes

Want to run your own instance (private data, custom models, no rate limits)?

### 1. Clone & install

```bash
git clone https://github.com/duckyquang/Co-Scientist.git
cd Co-Scientist

python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

### 2. Configure your LLM (pick one)

**Groq — free tier, recommended**
```bash
echo "GROQ_API_KEY=gsk_..." >> .env
```

**Anthropic / OpenAI / OpenRouter**
```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env
# or OPENAI_API_KEY / OPENROUTER_API_KEY
```

**Ollama — fully local, no API key**
```bash
ollama pull llama3.3:70b
# Then set provider = "ollama" in co-scientist.toml
```

**Literature grounding — no key needed.** The `openalex_search`, `pubmed_search`,
`arxiv_search`, and `europe_pmc_search` tools query keyless public APIs and are always
available, giving agents real papers with resolving DOIs out of the box. General
`web_search` auto-activates only when you set `TAVILY_API_KEY` or `BRAVE_API_KEY`.

### 3. Build the UI & run

```bash
cd frontend && npm install && npm run build && cd ..
python -m webapp.server --port 8080
```

Open **http://localhost:8080** — full dashboard, live agent updates.

**Dev mode** (hot-reload):
```bash
# Terminal 1
python -m webapp.server --port 8080

# Terminal 2
cd frontend && npm run dev   # proxies API → :8080
```

### Docker

```bash
docker compose up --build
# → http://localhost:8080
```

---

## ☁️ Free cloud hosting

Host your own public instance at **$0/month**:

| Service | What it hosts | Cost |
|---|---|---|
| **Groq** | AI inference (Llama 3.3 70B) | Free tier |
| **Oracle Cloud Always Free** | Python backend (ARM VM) | Free forever |
| **Vercel / GitHub Pages** | React frontend | Free |

**Full guide:** [`deploy/oracle/README.md`](deploy/oracle/README.md)

Quick steps:
1. Create an Ubuntu ARM instance on [Oracle Cloud Always Free](https://www.oracle.com/cloud/free/) (`VM.Standard.A1.Flex`)
2. SSH in and run:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/duckyquang/Co-Scientist/main/deploy/oracle/setup.sh | bash
   ```
3. Set `VITE_API_URL=https://api.yourdomain.com` in your Vercel/GitHub Actions env vars
4. Deploy the frontend — done

---

## 🖥️ Architecture

```
                     User goal (browser)
                              │
                              ▼
          ┌──────────────────────────────────────┐
          │  Python backend (webapp/server.py)   │
          │  SQLite · SSE live stream · REST API │
          └──────────────────────────────────────┘
                              │
                              ▼
              ─── Simulator / real engine ───

    Generate hypotheses   (literature review + debate)
             │
             ▼
    Reflect   (novelty · correctness · testability)
             │
             ▼         ┐
    Elo tournament     │  loop each round
             │         │  until the board
             ▼         │  is stable or the
    Evolve top ideas   │  token budget is
    (multi-round)      │  spent
             │         │
             ▼         │
    Self-critique      ┘
             │
             ▼
    Stress-test the TOP 3   ◄── the headline stage
      · search for contradicting evidence
      · verify every citation
      · feasibility + prototype-scale experiment
             │
             ▼
    Apply fixes → final head-to-head re-rank
             │
             ▼
    Meta-review proposal
    (inline [n] citations + numbered References)
```

Proximity clustering runs throughout for dedup and matchmaking.

---

## ⚙️ Configuration

Layered config: [`config/default.toml`](config/default.toml) → `~/.co-scientist/config.toml` → `./co-scientist.toml`

| Provider | Env var | Free tier |
|---|---|---|
| `groq` | `GROQ_API_KEY` | ✅ Yes — Llama 3.3 70B |
| `gemini` | `GEMINI_API_KEY` | ✅ Yes — Flash 1M tokens/day |
| `anthropic` | `ANTHROPIC_API_KEY` | ❌ Paid |
| `openai` | `OPENAI_API_KEY` | ❌ Paid |
| `openrouter` | `OPENROUTER_API_KEY` | Varies |
| `ollama` | *(none)* | ✅ Local |

---

## 🖱️ CLI (optional)

```bash
co-scientist run "Identify hypotheses about microbiome-driven inflammation" --n 3
co-scientist serve          # web dashboard (recommended)
co-scientist report <id>
```

---

## 📦 Repository layout

```
co_scientist/     # Python engine — agents, LLM, storage
frontend/         # React 18 + Vite + Tailwind dashboard
webapp/           # Stdlib HTTP server, simulator, seeder
config/           # default.toml + agent prompts
deploy/           # Oracle Cloud & Docker setup scripts
```

---

## 🚢 Deploy targets

| Target | Command / workflow |
|---|---|
| **GitHub Pages** (static) | `.github/workflows/deploy-pages.yml` |
| **Oracle Cloud** (full backend) | [`deploy/oracle/README.md`](deploy/oracle/README.md) |
| **Docker** (local / VPS) | `docker compose up` |

---

## 📄 License

Apache-2.0 — see [LICENSE](LICENSE).
