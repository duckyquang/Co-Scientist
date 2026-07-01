import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Bot, Rocket } from "lucide-react";
import { api } from "../api";
import { Loader } from "../components/ui";
import { isSimulatedMode } from "../lib/live";
import { activeProvider } from "../lib/llm";

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

  // What actually answers this session: a live model when a credential is baked
  // in (Groq key / Pollinations token), else a prompt-aware in-browser
  // simulation. The copy is honest about each.
  const inBrowser = isSimulatedMode();
  const provider = inBrowser ? activeProvider() : "server";
  const chip =
    provider === "server"
      ? {
          title: "Powered by Groq · Llama 3.3 70B",
          sub: "Free · no API key required · runs on our server",
          privacy: null as string | null,
        }
      : provider === "groq"
        ? {
            title: "Powered by Groq · Llama 3.3 70B",
            sub: "Free · reads your prompt live · runs in your browser",
            privacy: "Your prompt is sent to Groq to generate hypotheses.",
          }
        : provider === "keyless"
          ? {
              title: "Reads your prompt live · free AI",
              sub: "Free · no account · an offline demo covers you if the AI is unreachable",
              privacy: "Your prompt is sent to a free third-party AI (Pollinations) to generate hypotheses — nothing is stored by us.",
            }
          : {
              title: "Prompt-aware simulation · runs in your browser",
              sub: "Free · no key, no account · nothing leaves your device",
              privacy: "Hypotheses are generated locally from your prompt. Bake in a free Groq key for a live model's reasoning.",
            };


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
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-fg">
          Start a research session
        </h1>
        <p className="mt-1 text-sm text-muted">
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
                className="rounded-full border border-line bg-surface-2 px-3 py-1 text-[12px] text-muted transition hover:border-blue-500/40 hover:text-fg"
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
              <span className="text-sm font-semibold text-fg">${budget}</span>
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
              <span className="text-sm font-semibold text-fg">{nInitial}</span>
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
              <span className="text-sm font-semibold text-fg">
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
        <div>
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-600/20 text-blue-600 dark:text-blue-400">
              <Bot className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-medium text-fg">{chip.title}</div>
              <div className="text-[11px] text-faint">{chip.sub}</div>
            </div>
            <span className="ml-auto rounded-full bg-blue-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/25">
              FREE
            </span>
          </div>
          {chip.privacy && (
            <p className="mt-1.5 px-1 text-[11px] leading-snug text-faint">{chip.privacy}</p>
          )}
        </div>

        {/* Launch row */}
        <div className="card flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center">
          <div>
            <div className="label">Cost</div>
            <div className="mt-1 text-sm text-muted">
              <span className="font-semibold text-fg">Free</span>
            </div>
          </div>
          <button onClick={submit} className="btn-primary w-full py-2.5 sm:w-auto sm:px-8">
            <Rocket className="h-4 w-4" /> Launch session
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
