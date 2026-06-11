import { useState } from "react";
import { README_LOCAL_URL } from "../lib/config";
import { setDeploymentMode } from "../lib/credentials";

interface Props {
  open: boolean;
  onClose: () => void;
  onCloud: () => void;
}

export function OnboardingModal({ open, onClose, onCloud }: Props) {
  const [hover, setHover] = useState<"local" | "cloud" | null>(null);

  if (!open) return null;

  function pickLocal() {
    setDeploymentMode("local");
    window.open(README_LOCAL_URL, "_blank", "noopener,noreferrer");
    onClose();
  }

  function pickCloud() {
    setDeploymentMode("cloud");
    onCloud();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="card max-w-2xl w-full p-8 animate-fade-up">
        <div className="mb-2 text-center text-4xl">🧬</div>
        <h2 className="text-center text-2xl font-extrabold text-white">Welcome to Co-Scientist</h2>
        <p className="mt-3 text-center text-sm leading-relaxed text-slate-400">
          Choose how you want to run the multi-agent research engine. You can switch later in Settings.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <button
            onClick={pickLocal}
            onMouseEnter={() => setHover("local")}
            onMouseLeave={() => setHover(null)}
            className={`rounded-2xl border p-6 text-left transition ${
              hover === "local"
                ? "border-brand-400/50 bg-brand-500/10"
                : "border-white/10 bg-white/[0.02] hover:border-white/20"
            }`}
          >
            <div className="text-2xl">💻</div>
            <div className="mt-3 text-lg font-bold text-white">Option 1 — Run locally</div>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Clone the repo and run on your machine. Use Ollama or any provider with your own keys in{" "}
              <code className="text-brand-300">.env</code>. Full control, no data leaves your machine.
            </p>
            <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-brand-300">
              Opens setup guide →
            </div>
          </button>

          <button
            onClick={pickCloud}
            onMouseEnter={() => setHover("cloud")}
            onMouseLeave={() => setHover(null)}
            className={`rounded-2xl border p-6 text-left transition ${
              hover === "cloud"
                ? "border-flux-400/50 bg-flux-500/10"
                : "border-white/10 bg-white/[0.02] hover:border-white/20"
            }`}
          >
            <div className="text-2xl">🌐</div>
            <div className="mt-3 text-lg font-bold text-white">Option 2 — Use the website</div>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Stay in the browser and paste your own LLM API key. Keys are stored only in your browser
              and sent directly to the hosted API — never saved on our servers.
            </p>
            <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-flux-300">
              Configure API key →
            </div>
          </button>
        </div>

        <button
          onClick={() => { setDeploymentMode("cloud"); onClose(); }}
          className="mt-6 w-full text-center text-xs text-slate-500 hover:text-slate-300"
        >
          Skip for now — browse the demo
        </button>
      </div>
    </div>
  );
}
