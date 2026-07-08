import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Loader } from "../components/ui";
import { fmtCompact, fmtDuration } from "../lib/format";
import { isSimulatedMode } from "../lib/live";
import { RUN_PRESETS, type RunPreset } from "../types";

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
  const [presetId, setPresetId] = useState<RunPreset["id"]>("standard");
  const [advanced, setAdvanced] = useState(false);
  const [tokensM, setTokensM] = useState(5);       // millions of tokens
  const [minutes, setMinutes] = useState(30);
  const [nInitial, setNInitial] = useState(4);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const simulated = isSimulatedMode();
  const preset = RUN_PRESETS.find((p) => p.id === presetId)!;

  // Resolve the effective run limits: advanced overrides, else the chosen preset.
  const budgetTokens = advanced ? Math.round(tokensM * 1_000_000) : preset.budget_tokens;
  const wallSeconds = advanced ? minutes * 60 : preset.wall_clock_seconds;
  const initial = advanced ? nInitial : preset.n_initial;

  function choosePreset(p: RunPreset) {
    setPresetId(p.id);
    setTokensM(Math.round(p.budget_tokens / 1_000_000));
    setMinutes(Math.round(p.wall_clock_seconds / 60));
    setNInitial(p.n_initial);
  }

  async function submit() {
    if (goal.trim().length < 12) {
      setError("Describe a research goal — at least a sentence.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { session_id } = await api.create({
        goal: goal.trim(),
        budget_tokens: budgetTokens,
        wall_clock_seconds: wallSeconds,
        n_initial: initial,
        provider: "groq", // server default — no user key needed
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
          Describe what you want to discover. Six AI agents generate hypotheses
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
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[12px] text-slate-400 transition hover:border-brand-500/40 hover:text-slate-200"
              >
                {ex.length > 52 ? ex.slice(0, 52) + "…" : ex}
              </button>
            ))}
          </div>
        </div>

        {/* Run effort — presets replace the old dollar budget */}
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <label className="label">How hard should it work?</label>
            <button
              onClick={() => setAdvanced((v) => !v)}
              className="text-[11px] font-medium text-brand-400 hover:text-brand-300"
            >
              {advanced ? "Use presets" : "Advanced"}
            </button>
          </div>

          {!advanced ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {RUN_PRESETS.map((p) => {
                const active = p.id === presetId;
                return (
                  <button
                    key={p.id}
                    onClick={() => choosePreset(p)}
                    className={`rounded-xl border p-3.5 text-left transition ${
                      active
                        ? "border-accent-500/50 bg-accent-500/[0.07] shadow-glowAccent"
                        : "border-white/[0.07] bg-white/[0.02] hover:border-white/[0.14]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-bold ${active ? "text-accent-300" : "text-slate-200"}`}>
                        {p.label}
                      </span>
                      {active && <span className="h-2 w-2 rounded-full bg-accent-400 shadow-glowAccent" />}
                    </div>
                    <p className="mt-1.5 text-[11.5px] leading-snug text-slate-500">{p.blurb}</p>
                    <div className="mt-3 space-y-0.5 text-[11px] text-slate-400">
                      <div>≤ {fmtCompact(p.budget_tokens)} tokens</div>
                      <div>≤ {fmtDuration(p.wall_clock_seconds)} run time</div>
                      <div>{p.n_initial} starting ideas</div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 space-y-5">
              <div>
                <div className="flex justify-between">
                  <label className="label">Token cap</label>
                  <span className="text-sm font-semibold text-white">{tokensM}M tokens</span>
                </div>
                <input type="range" min={0.5} max={30} step={0.5} value={tokensM}
                  onChange={(e) => setTokensM(+e.target.value)}
                  className="mt-3 w-full accent-brand-500" />
              </div>
              <div>
                <div className="flex justify-between">
                  <label className="label">Time limit</label>
                  <span className="text-sm font-semibold text-white">{fmtDuration(minutes * 60)}</span>
                </div>
                <input type="range" min={5} max={120} step={5} value={minutes}
                  onChange={(e) => setMinutes(+e.target.value)}
                  className="mt-3 w-full accent-brand-500" />
              </div>
              <div>
                <div className="flex justify-between">
                  <label className="label">Starting ideas</label>
                  <span className="text-sm font-semibold text-white">{nInitial}</span>
                </div>
                <input type="range" min={2} max={8} step={1} value={nInitial}
                  onChange={(e) => setNInitial(+e.target.value)}
                  className="mt-3 w-full accent-brand-500" />
              </div>
              <p className="text-[11px] text-slate-500">
                The run stops when it hits whichever limit comes first — the token cap or the time limit.
              </p>
            </div>
          )}
        </div>

        {/* Run-mode chip — honest about where the session actually runs */}
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-600/20 text-sm">
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
          <span className="ml-auto rounded-full bg-accent-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-accent-400 ring-1 ring-accent-500/25">
            FREE
          </span>
        </div>

        {/* Launch */}
        <div className="card flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center">
          <div className="text-sm text-slate-400">
            Runs up to <span className="font-semibold text-white">{fmtCompact(budgetTokens)} tokens</span> or{" "}
            <span className="font-semibold text-white">{fmtDuration(wallSeconds)}</span>.
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
