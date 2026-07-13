<div align="center">

# 🧬 Co-Scientist

**A multi-agent research engine that turns a natural-language goal into tournament-ranked hypotheses.**

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11--3.13-blue.svg)](https://www.python.org/)
[![Live Demo](https://img.shields.io/badge/demo-live-3b82f6.svg)](https://duckyquang.github.io/Co-Scientist/)

*Created by **Quang Bui***

</div>

---

## ✨ What it does

An open-source re-implementation of Google's **AI co-scientist** ([Gottweis et al., *Nature*, 2026](https://www.nature.com/articles/s41586-026-10644-y)) — six specialised agents collaborate through an Elo tournament to produce a ranked research overview.

| Agent | Role |
|---|---|
| **Generation** | Proposes hypotheses via literature review and debate |
| **Reflection** | Reviews novelty, correctness, testability |
| **Ranking** | Elo tournament with pairwise debates |
| **Evolution** | Combines and refines top hypotheses |
| **Proximity** | Clusters hypotheses for dedup and matchmaking |
| **Meta-review** | Synthesises the final research overview |

> Independent project — not affiliated with Google or the paper's authors.

### 🎚️ Hypothesis modes

The New Session form has three modes controlling how many parallel generation
agents run:

| Mode | Initial hypotheses | When to use |
|---|---|---|
| **Quick** | 5 | Fast sanity check of an idea |
| **Standard** *(default)* | 15 | Balanced breadth vs. runtime |
| **Deep** | 50 | Exhaustive exploration of a goal |

All three runtimes — the in-browser simulator, the `webapp` Python simulator,
and the real engine — accept up to 50 parallel hypotheses.

### 💬 Chat follow-ups

Every session has a chat panel (`POST /api/sessions/{id}/chat`) that routes
your message by intent:

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

### 📚 Citations guaranteed

Every research proposal ends with a numbered `## References` section, with
inline `[n]` markers throughout the text. The real engine builds it only from
papers actually fetched during literature search (`CitedPaper` records) and
marks any entry the citation verifier couldn't confirm as `(unverified)`.
Simulators show well-formed sample references.

---

## 🚀 Quick start — no setup required

1. **Visit the live site** → [duckyquang.github.io/Co-Scientist](https://duckyquang.github.io/Co-Scientist/)
2. Click **"Start a research session"**
3. Pick a mode — **Quick** (5), **Standard** (15, default), or **Deep** (50
   initial hypotheses)
4. Type your research question and hit **Launch**

**No account. No API key. No configuration** — for the visitor. Type a prompt and six
agents generate, debate, and Elo-rank hypotheses, then write a final overview —
§-numbered sections, inline `[n]` citations, and a `## References` list included.
When it's done, ask follow-up questions or request changes in the session's chat panel.

The UI is an academic "graph-paper" design inspired by
[GEML](https://saidlaboratory.github.io/GEML/): serif typography, mono
micro-labels, a paper-and-grid background, flat 1px-rule cards, and a
red/blue/green accent system. Light and dark follow your OS setting
(`prefers-color-scheme`), and the hypothesis drawer slides in from the right.

**How the live site answers prompts** depends on one repo setting:

- **Prompt-aware simulation (default, no setup).** With no credential, the site runs a
  clearly-labeled **in-browser simulation** that actually reads your prompt: it extracts
  the key terms, infers the domain (transport, energy, education, biomedicine, …), and
  generates **on-topic** hypotheses locally — nothing leaves your device. It reflects the
  prompt but isn't a live model's reasoning.
- **Live Groq reasoning (recommended).** Add a free [Groq](https://console.groq.com/keys)
  key as a `GROQ_API_KEY` repo **secret** — the deploy workflow bakes it into the build
  (`VITE_GROQ_API_KEY`) and every prompt is answered for real by Llama 3.3 70B, with
  nothing for the visitor to enter. ⚠️ A key baked into a static site is publicly visible,
  so use a **free, rotatable** key you can revoke — never a paid one. (Browsers can't call
  Groq anonymously, which is why a baked key is what enables live reasoning.)

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
          ┌───────────────────┴───────────────────┐
          │          Simulator / real engine       │
          │  Generation → Reflection → Ranking    │
          │  → Evolution → Proximity → Meta-review│
          └────────────────────────────────────────┘
```

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
