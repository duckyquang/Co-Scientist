<div align="center">

# 🧬 Co-Scientist

**A multi-agent research engine that turns a natural-language goal into tournament-ranked hypotheses.**

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11--3.13-blue.svg)](https://www.python.org/)
[![Live Demo](https://img.shields.io/badge/demo-GitHub%20Pages-6366f1.svg)](https://duckyquang.github.io/Co-Scientist/)

*Created by **Quang Bui***

</div>

---

## Choose how to run Co-Scientist

Co-Scientist supports **two ways** to use the same web dashboard:

| | **Option 1 — Run locally** | **Option 2 — Use the website + your API key** |
|---|---|---|
| **Best for** | Full privacy, local models (Ollama), your own hardware | Quick start in the browser with your cloud LLM account |
| **API keys** | Stored in your `.env` file on your machine | Pasted in the browser Settings (stored locally in your browser only) |
| **Engine** | Real multi-agent pipeline on your machine | Real pipeline on a hosted API you connect to |
| **Cost** | You pay your LLM provider directly | You pay your LLM provider directly |

> On the [public demo site](https://duckyquang.github.io/Co-Scientist/), an onboarding popup lets you pick either option. **Option 1** opens this README's local setup guide. **Option 2** opens Settings to paste your API key.

---

## Option 1 — Run locally

Clone the repo, install dependencies, and run the full web app on your machine. Use **Ollama** for a local model, or any cloud provider via `.env`.

### 1. Clone & install

```bash
git clone https://github.com/duckyquang/Co-Scientist.git
cd Co-Scientist

python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

cp .env.example .env
# Add your API key, or use Ollama (no key needed):
#   [llm]
#   provider = "ollama"
```

### 2. Initialize & build the UI

```bash
co-scientist init

cd frontend && npm install && npm run build && cd ..
```

### 3. Start the web app

```bash
co-scientist serve --host 127.0.0.1 --port 8080
```

Open **http://127.0.0.1:8080** — the React dashboard and real agent engine run together.

**Dev mode** (hot-reload frontend):

```bash
# Terminal 1
co-scientist serve --port 8080

# Terminal 2
cd frontend && npm run dev
```

Open **http://localhost:5173** (Vite proxies API calls to port 8080).

### Local model with Ollama

```bash
ollama pull llama3.3:70b
```

```toml
# co-scientist.toml
[llm]
provider = "ollama"

[models]
generation = "llama3.3:70b"
reflection = "llama3.3:70b"
ranking_pairwise = "llama3.3:70b"
# ... set all model keys to your Ollama model tag
```

### Docker (local or self-hosted)

```bash
docker compose up --build
```

Open **http://localhost:8080**.

---

## Option 2 — Use the website with your API key

The [public site](https://duckyquang.github.io/Co-Scientist/) is a static frontend. To **launch real sessions** from the browser:

1. Visit the site — the onboarding popup appears on first visit.
2. Choose **Option 2 — Use the website**.
3. Open **Settings** and paste your LLM API key (Anthropic, OpenAI, OpenRouter, etc.).
4. The frontend sends your key with each request to the hosted API. **Keys are never stored on the server** — only in your browser's local storage.

### Host the API on Oracle Cloud (free, recommended)

We ship a one-command bootstrap for **Oracle Always Free** ARM VMs — $0/month, persistent disk, no server-side API keys needed.

**Full guide:** [`deploy/oracle/README.md`](deploy/oracle/README.md)

Quick summary:

1. Create an Ubuntu ARM instance on Oracle Cloud (Always Free `VM.Standard.A1.Flex`)
2. Point `api.yourdomain.com` → VM public IP (HTTPS required for GitHub Pages)
3. SSH in and run:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/duckyquang/Co-Scientist/main/deploy/oracle/setup.sh | bash
   ```
4. Set GitHub repo variable **`VITE_API_URL`** = `https://api.yourdomain.com`
5. Re-run the **Deploy to GitHub Pages** workflow

Users paste their own LLM keys in Settings — you pay nothing for inference.

### Browse without keys

You can always explore **pre-seeded demo sessions** on GitHub Pages without an API key — read-only snapshots of sample research runs.

---

## ✨ What Co-Scientist does

An open-source re-implementation of Google's **AI co-scientist** ([Gottweis et al., *Nature*, 2026](https://www.nature.com/articles/s41586-026-10644-y)) — six specialized agents collaborate through an Elo tournament to produce a ranked research overview of novel hypotheses.

| Agent | Role |
|---|---|
| **Generation** | Proposes hypotheses via literature review and debate |
| **Reflection** | Reviews novelty, correctness, testability |
| **Ranking** | Elo tournament with pairwise debates |
| **Evolution** | Combines and refines top hypotheses |
| **Proximity** | Clusters hypotheses for dedup and matchmaking |
| **Meta-review** | Synthesizes the final research overview |

> Independent project — not affiliated with Google or the paper's authors.

---

## 🏗️ Architecture

```
                       User goal (web or CLI)
                                  │
                                  ▼
            ┌──────────────────────────────────────┐
            │            Supervisor                │
            │  parse_goal → task queue → agents    │
            └──────────────────────────────────────┘
                                  │
            Generation → Reflection → Ranking (Elo)
                    → Evolution → Proximity → Meta-review
```

---

## ⚙️ Configuration

Layered config: [`config/default.toml`](config/default.toml) → `~/.co-scientist/config.toml` → `./co-scientist.toml`

| Provider | API key env var | Example models |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-opus-4-7`, `claude-sonnet-4-6` |
| `openai` | `OPENAI_API_KEY` | `gpt-5`, `gpt-4o` |
| `openrouter` | `OPENROUTER_API_KEY` | `openai/gpt-5`, `google/gemini-2.5-pro` |
| `ollama` | *(none — local)* | `llama3.3:70b` |

---

## 🖥️ CLI (optional)

The CLI remains available for scripting and power users:

```bash
co-scientist run "Identify hypotheses about microbiome-driven inflammation" --n 3
co-scientist serve          # web UI + API (recommended)
co-scientist report <id>
co-scientist bench --preset paper
```

---

## 📦 Repository layout

```
co_scientist/     # Python engine — agents, LLM, storage, tools
frontend/         # React dashboard (primary UI)
co_scientist/web/ # FastAPI — JSON API + serves React build
webapp/           # Demo seeder + legacy simulator helpers
config/           # default.toml + agent prompts
```

---

## 🚢 Deploy

| Target | What deploys | Command / workflow |
|---|---|---|
| **GitHub Pages** | Static React demo + onboarding | `.github/workflows/deploy-pages.yml` |
| **Oracle Cloud (free)** | API + engine + HTTPS (Option 2) | [`deploy/oracle/README.md`](deploy/oracle/README.md) |
| **Docker (local/VPS)** | Full stack (UI + API + engine) | `docker compose up` |
| **Connect Pages → API** | Set `VITE_API_URL` variable in GitHub Actions | Rebuild Pages workflow |

Enable **GitHub Pages → Source: GitHub Actions** in repo settings.

---

## 📄 License

Apache-2.0 — see [LICENSE](LICENSE).
