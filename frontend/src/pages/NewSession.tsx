import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Loader } from "../components/ui";
import { isSimulatedMode } from "../lib/live";

const EXAMPLES = [
  "Identify novel drug-repurposing candidates for acute myeloid leukemia (AML)",
  "Propose mechanisms linking the gut microbiome to neuroinflammation",
  "Find testable strategies to extend the lifespan of human cardiac organoids",
  "Generate hypotheses for overcoming antibody resistance in HER2+ breast cancer",
];

export default function NewSession() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();

  const [goal, setGoal] = useState(() => searchParams.get("goal") ?? "");
  const [budget, setBudget] = useState(5);
  const [nInitial, setNInitial] = useState(4);
  const [speed, setSpeed] = useState(0.5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const simulated = isSimulatedMode();


  async function submit() {
    if (goal.trim().length < 12) {
      setError("Please describe a research goal (at least a sentence).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { session_id } = await api.create({
        goal: goal.trim(),
        budget_usd: budget,
        n_initial: nInitial,
        provider: "groq",   // server default — no user key needed
        speed,
      });
      nav(`/s/${session_id}`);
    } catch (e: any) {
      setError(e.message || "Failed to start session");
      setSubmitting(false);
    }
  }

  if (submitting) {
    return (
      <div className="mx-auto max-w-xl">
        <Loader label="Spinning up your research session" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-white">
          Start a research session
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Describe what you want to discover. Six AI agents will generate hypotheses
          and rank them through an Elo tournament — live.
        </p>
      </div>

      <div className="space-y-5">
        {/* Research goal */}
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
              <button
                key={ex}
                onClick={() => setGoal(ex)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[12px] text-slate-400 transition hover:border-blue-500/40 hover:text-slate-200"
              >
                {ex.length > 52 ? ex.slice(0, 52) + "…" : ex}
              </button>
            ))}
          </div>
        </div>

        {/* Parameters */}
        <div className="card space-y-5 p-5">
          <div>
            <div className="flex justify-between">
              <label className="label">Budget</label>
              <span className="text-sm font-semibold text-white">${budget}</span>
            </div>
            <input
              type="range" min={1} max={30} step={0.5} value={budget}
              onChange={(e) => setBudget(+e.target.value)}
              className="mt-3 w-full accent-brand-500"
            />
          </div>
          <div>
            <div className="flex justify-between">
              <label className="label">Initial hypotheses</label>
              <span className="text-sm font-semibold text-white">{nInitial}</span>
            </div>
            <input
              type="range" min={2} max={8} step={1} value={nInitial}
              onChange={(e) => setNInitial(+e.target.value)}
              className="mt-3 w-full accent-brand-500"
            />
          </div>
          <div>
            <div className="flex justify-between">
              <label className="label">Simulation speed</label>
              <span className="text-sm font-semibold text-white">
                {speed <= 0.35 ? "Fast" : speed >= 0.9 ? "Realistic" : "Medium"}
              </span>
            </div>
            <input
              type="range" min={0.2} max={1.2} step={0.1} value={speed}
              onChange={(e) => setSpeed(+e.target.value)}
              className="mt-3 w-full accent-brand-500"
            />
          </div>
        </div>

        {/* Run-mode chip — honest about where the session actually runs */}
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-600/20 text-sm">
            {simulated ? "🧪" : "🤖"}
          </div>
          <div>
            <div className="text-sm font-medium text-white">
              {simulated
                ? "Interactive simulation · runs in your browser"
                : "Powered by Groq · Llama 3.3 70B"}
            </div>
            <div className="text-[11px] text-zinc-500">
              {simulated
                ? "Free · no API key, no account · nothing leaves your device"
                : "Free · no API key required · runs on our server"}
            </div>
          </div>
          <span className="ml-auto rounded-full bg-blue-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-blue-400 ring-1 ring-blue-500/25">
            FREE
          </span>
        </div>

        {/* Launch row */}
        <div className="card flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center">
          <div>
            <div className="label">Cost</div>
            <div className="mt-1 text-sm text-slate-300">
              <span className="font-semibold text-white">Free</span>
            </div>
          </div>
          <button onClick={submit} className="btn-primary w-full py-2.5 sm:w-auto sm:px-8">
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
