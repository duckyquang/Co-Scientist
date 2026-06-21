import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Loader } from "../components/ui";
import { fmtUsd } from "../lib/format";
import { IS_STATIC_DEMO, README_LOCAL_URL } from "../lib/config";
import { getDeploymentMode } from "../lib/credentials";
import { canUseLiveApi } from "../lib/live";
import { usePoll } from "../lib/hooks";
import type { Meta } from "../types";

const EXAMPLES = [
  "Identify novel drug-repurposing candidates for acute myeloid leukemia (AML)",
  "Propose mechanisms linking the gut microbiome to neuroinflammation",
  "Find testable strategies to extend the lifespan of human cardiac organoids",
  "Generate hypotheses for overcoming antibody resistance in HER2+ breast cancer",
];

export default function NewSession({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: meta } = usePoll<Meta>(() => api.meta(), [], null);
  const [goal, setGoal] = useState(() => searchParams.get("goal") ?? "");
  const [provider, setProvider] = useState("anthropic");
  const [budget, setBudget] = useState(5);
  const [nInitial, setNInitial] = useState(4);
  const [speed, setSpeed] = useState(0.5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estLow = (budget * 0.7).toFixed(2);
  const estHigh = (budget * 1.05).toFixed(2);

  async function submit() {
    if (goal.trim().length < 12) {
      setError("Please describe a research goal (at least a sentence).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { session_id } = await api.create({
        goal: goal.trim(), budget_usd: budget, n_initial: nInitial, provider, speed,
      });
      nav(`/s/${session_id}`);
    } catch (e: any) {
      setError(e.message || "Failed to start session");
      setSubmitting(false);
    }
  }

  const mode = getDeploymentMode();
  const liveReady = canUseLiveApi() || !IS_STATIC_DEMO;

  if (IS_STATIC_DEMO && !liveReady) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <div className="card p-8 text-center">
          <div className="text-4xl">{mode === "local" ? "💻" : "🌐"}</div>
          <h1 className="mt-4 text-2xl font-bold text-white">
            {mode === "local" ? "Run locally to create sessions" : "Add your API key to start"}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            {mode === "local"
              ? "Clone the repo and run Co-Scientist on your machine with your local model or .env API keys."
              : "Cloud mode needs your LLM API key in Settings. Keys stay in your browser only."}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {mode === "local" ? (
              <a href={README_LOCAL_URL} target="_blank" rel="noopener noreferrer" className="btn-primary inline-flex">
                Local setup guide
              </a>
            ) : (
              <button onClick={onOpenSettings} className="btn-primary">Open Settings</button>
            )}
            <Link to="/" className="btn-ghost">Browse demo sessions</Link>
          </div>
        </div>
      </div>
    );
  }

  if (submitting) {
    return (
      <div className="mx-auto max-w-xl">
        <Loader label="Spinning up the supervisor and parsing your goal" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-white">Start a research session</h1>
        <p className="mt-1 text-sm text-slate-400">
          Describe what you want to discover. The agent system will parse it into a research plan,
          generate hypotheses, and rank them through an Elo tournament — live.
        </p>
      </div>

      <div className="space-y-6">
        <div className="card p-5">
          <label className="label">Research goal</label>
          <textarea
            className="input mt-2 min-h-[110px] resize-y text-[15px]"
            placeholder="e.g. Identify novel drug-repurposing candidates for acute myeloid leukemia…"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            autoFocus
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => setGoal(ex)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[12px] text-slate-400 transition hover:border-brand-500/40 hover:text-slate-200">
                {ex.length > 52 ? ex.slice(0, 52) + "…" : ex}
              </button>
            ))}
          </div>
        </div>

        {/* Free hosting callout */}
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.06] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-blue-300">
            <span>✅ Run for free 24/7</span>
          </div>
          <p className="mt-1 text-[13px] text-blue-100/70">
            Use <strong className="text-blue-300">Groq</strong> (Llama 3.3 70B · free API tier) or{" "}
            <strong className="text-blue-300">Google Gemini</strong> (Flash · 1M tokens/day free) for zero-cost AI.
            Host the server on <strong className="text-blue-300">Oracle Cloud Always Free</strong> (2 VMs, forever free)
            + the frontend on <strong className="text-blue-300">Vercel</strong>.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="card p-5">
            <label className="label">LLM provider</label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(meta?.providers || []).map((p) => {
                const isFree = ["groq", "gemini", "ollama"].includes(p.id);
                return (
                  <button key={p.id} onClick={() => setProvider(p.id)}
                    className={`relative rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                      provider === p.id
                        ? "border-brand-500/60 bg-brand-500/15 text-white"
                        : "border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:border-zinc-700"
                    }`}>
                    {isFree && (
                      <span className="absolute -top-2 -right-1 rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-400 ring-1 ring-blue-500/30">
                        FREE
                      </span>
                    )}
                    <div className="font-semibold">{p.label}</div>
                    <div className="truncate text-[11px] text-zinc-500">{p.models[0]}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="card space-y-5 p-5">
            <div>
              <div className="flex justify-between">
                <label className="label">Budget</label>
                <span className="text-sm font-semibold text-white">{fmtUsd(budget)}</span>
              </div>
              <input type="range" min={1} max={30} step={0.5} value={budget}
                onChange={(e) => setBudget(+e.target.value)}
                className="mt-3 w-full accent-brand-500" />
            </div>
            <div>
              <div className="flex justify-between">
                <label className="label">Initial hypotheses</label>
                <span className="text-sm font-semibold text-white">{nInitial}</span>
              </div>
              <input type="range" min={2} max={8} step={1} value={nInitial}
                onChange={(e) => setNInitial(+e.target.value)}
                className="mt-3 w-full accent-brand-500" />
            </div>
            <div>
              <div className="flex justify-between">
                <label className="label">Demo pace</label>
                <span className="text-sm font-semibold text-white">
                  {speed <= 0.35 ? "Fast" : speed >= 0.9 ? "Realistic" : "Medium"}
                </span>
              </div>
              <input type="range" min={0.2} max={1.2} step={0.1} value={speed}
                onChange={(e) => setSpeed(+e.target.value)}
                className="mt-3 w-full accent-brand-500" />
            </div>
          </div>
        </div>

        <div className="card flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center">
          <div>
            <div className="label">Pre-flight estimate</div>
            <div className="mt-1 text-sm text-slate-300">
              Expected spend{" "}
              <span className="font-semibold text-white">${estLow}–${estHigh}</span>{" "}
              · {meta?.demo_mode ? "running in key-free demo mode" : "live engine"}
            </div>
          </div>
          <button onClick={submit} className="btn-primary w-full sm:w-auto">
            🚀 Launch session
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-zinc-600/40 bg-zinc-800/60 px-4 py-3 text-sm text-zinc-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
