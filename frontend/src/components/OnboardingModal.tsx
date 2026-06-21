import { useState } from "react";
import { setCredentials, setDeploymentMode } from "../lib/credentials";

interface Props {
  open: boolean;
  onClose: () => void;
  onCloud?: () => void;
}

const STEPS = ["welcome", "setup", "ready"] as const;
type Step = (typeof STEPS)[number];

export function OnboardingModal({ open, onClose }: Props) {
  const [step, setStep] = useState<Step>("welcome");
  const [apiKey, setApiKey] = useState("");
  const [keyError, setKeyError] = useState("");

  if (!open) return null;

  function finishWithKey() {
    const k = apiKey.trim();
    if (!k) { setKeyError("Paste your Groq API key above."); return; }
    if (!k.startsWith("gsk_") && !k.startsWith("groq_")) {
      setKeyError("Groq keys usually start with gsk_… Double-check and try again.");
      return;
    }
    setKeyError("");
    setDeploymentMode("cloud");
    setCredentials({ provider: "groq", apiKey: k });
    setStep("ready");
  }

  function skipToDemo() {
    setDeploymentMode("cloud");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg animate-fade-up">

        {/* ── Step 1: Welcome ───────────────────────────────── */}
        {step === "welcome" && (
          <div className="card overflow-hidden">
            {/* top blue strip */}
            <div className="h-1 w-full bg-blue-600" />
            <div className="p-8">
              <div className="mb-5 flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-xl">🧬</div>
                <div>
                  <div className="text-lg font-bold text-white">Co-Scientist</div>
                  <div className="text-[11px] uppercase tracking-widest text-zinc-500">AI Research Engine</div>
                </div>
              </div>

              <h2 className="text-2xl font-extrabold tracking-tight text-white">
                Turn any question into<br />
                <span className="text-blue-400">ranked research hypotheses.</span>
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                Six specialised AI agents generate, critique, and tournament-rank ideas — so you can
                focus on the research, not the grunt work.
              </p>

              <div className="mt-6 space-y-3">
                {[
                  ["📝", "Write a research goal in plain English"],
                  ["⚔️", "Agents debate and Elo-rank every hypothesis"],
                  ["📄", "Get a final overview with the best findings"],
                ].map(([icon, text]) => (
                  <div key={text} className="flex items-start gap-3">
                    <span className="mt-px text-base">{icon}</span>
                    <span className="text-sm text-zinc-300">{text}</span>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row-reverse">
                <button onClick={() => setStep("setup")} className="btn-primary flex-1 py-2.5">
                  Get started — it's free →
                </button>
                <button onClick={skipToDemo} className="btn-ghost flex-1 py-2.5 text-zinc-500 hover:text-zinc-300">
                  Browse demo first
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2: Groq setup ───────────────────────────── */}
        {step === "setup" && (
          <div className="card overflow-hidden">
            <div className="h-1 w-full bg-blue-600" />
            <div className="p-8">
              <button onClick={() => setStep("welcome")} className="mb-5 text-xs text-zinc-600 hover:text-zinc-400">
                ← Back
              </button>

              <h2 className="text-xl font-bold text-white">Connect your free AI</h2>
              <p className="mt-2 text-sm text-zinc-400">
                We use <strong className="text-white">Groq</strong> — a free cloud AI service powered
                by Llama 3.3 70B. No credit card required.
              </p>

              {/* Steps */}
              <div className="mt-6 space-y-4">
                <div className="flex gap-4">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-[12px] font-bold text-blue-400 ring-1 ring-blue-500/30">
                    1
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">Create a free Groq account</div>
                    <a
                      href="https://console.groq.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300"
                    >
                      Open console.groq.com →
                    </a>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-[12px] font-bold text-blue-400 ring-1 ring-blue-500/30">
                    2
                  </div>
                  <div className="text-sm font-medium text-white">
                    Go to <span className="font-mono text-blue-300">API Keys</span> and click <span className="font-mono text-blue-300">Create API Key</span>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-[12px] font-bold text-blue-400 ring-1 ring-blue-500/30">
                    3
                  </div>
                  <div className="flex-1">
                    <div className="mb-2 text-sm font-medium text-white">Paste your key below</div>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => { setApiKey(e.target.value); setKeyError(""); }}
                      placeholder="gsk_…"
                      className="input w-full font-mono text-sm"
                      onKeyDown={(e) => e.key === "Enter" && finishWithKey()}
                    />
                    {keyError && <p className="mt-1.5 text-xs text-zinc-500">{keyError}</p>}
                    <p className="mt-2 text-[11px] text-zinc-600">
                      Stored in your browser only. Never sent to our servers.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
                <button onClick={finishWithKey} className="btn-primary flex-1 py-2.5">
                  Connect Groq →
                </button>
                <button onClick={skipToDemo} className="btn-ghost flex-1 py-2.5 text-zinc-500 hover:text-zinc-300">
                  Try demo mode first
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3: Ready ────────────────────────────────── */}
        {step === "ready" && (
          <div className="card overflow-hidden text-center">
            <div className="h-1 w-full bg-blue-600" />
            <div className="p-10">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-blue-600/20 ring-1 ring-blue-500/30">
                <svg className="h-8 w-8 text-blue-400" viewBox="0 0 24 24" fill="none">
                  <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h2 className="mt-5 text-2xl font-bold text-white">You're all set!</h2>
              <p className="mt-2 text-sm text-zinc-400">
                Your Groq key is connected. Start your first research session below.
              </p>
              <button onClick={onClose} className="btn-primary mt-8 w-full py-3 text-base font-semibold">
                Open dashboard →
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
