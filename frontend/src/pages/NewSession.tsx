import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Loader } from "../components/ui";
import { fmtUsd } from "../lib/format";
import { IS_STATIC_DEMO } from "../lib/config";
import { usePoll } from "../lib/hooks";
import type { Meta } from "../types";

const EXAMPLES = [
  "Identify novel drug-repurposing candidates for acute myeloid leukemia (AML)",
  "Propose mechanisms linking the gut microbiome to neuroinflammation",
  "Find testable strategies to extend the lifespan of human cardiac organoids",
  "Generate hypotheses for overcoming antibody resistance in HER2+ breast cancer",
];

export default function NewSession() {
  const nav = useNavigate();
  const { data: meta } = usePoll<Meta>(() => api.meta(), [], null);
  const [goal, setGoal] = useState("");
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

  if (IS_STATIC_DEMO) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="card p-8 text-center">
          <div className="text-4xl">🌐</div>
          <h1 className="mt-4 text-2xl font-bold text-white">Static demo</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            This GitHub Pages deployment is a read-only snapshot of sample research sessions.
            To launch new sessions with the live simulator, run the app locally.
          </p>
          <Link to="/" className="btn-primary mt-6 inline-flex">Browse demo sessions</Link>
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

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="card p-5">
            <label className="label">LLM provider</label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(meta?.providers || []).map((p) => (
                <button key={p.id} onClick={() => setProvider(p.id)}
                  className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                    provider === p.id
                      ? "border-brand-500/60 bg-brand-500/15 text-white"
                      : "border-white/10 bg-white/[0.02] text-slate-300 hover:border-white/20"
                  }`}>
                  <div className="font-semibold">{p.label}</div>
                  <div className="truncate text-[11px] text-slate-500">{p.models[0]}</div>
                </button>
              ))}
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
                className="mt-3 w-full accent-flux-500" />
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
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
