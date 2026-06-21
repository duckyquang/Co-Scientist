import { setDeploymentMode } from "../lib/credentials";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function OnboardingModal({ open, onClose }: Props) {
  if (!open) return null;

  function start() {
    setDeploymentMode("cloud"); // marks onboarding done
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg animate-fade-up">
        <div className="card overflow-hidden">
          <div className="h-1 w-full bg-blue-600" />
          <div className="p-8">
            {/* Logo */}
            <div className="mb-6 flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-xl shadow-glow">
                🧬
              </div>
              <div>
                <div className="text-lg font-bold text-white">Co-Scientist</div>
                <div className="text-[11px] uppercase tracking-widest text-zinc-500">
                  AI Research Engine
                </div>
              </div>
            </div>

            <h2 className="text-2xl font-extrabold tracking-tight text-white">
              Turn any question into<br />
              <span className="text-blue-400">ranked research hypotheses.</span>
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Six specialised AI agents generate, critique, and tournament-rank ideas
              — so you can focus on the research, not the grunt work.
            </p>

            {/* Feature bullets */}
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

            {/* Zero-setup callout */}
            <div className="mt-6 flex items-center gap-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.07] px-4 py-3">
              <span className="text-lg">✅</span>
              <p className="text-sm text-blue-100/80">
                <span className="font-semibold text-blue-300">No setup needed.</span>{" "}
                Start researching instantly — no API key, no account required.
              </p>
            </div>

            <button
              onClick={start}
              className="btn-primary mt-7 w-full py-3 text-base font-semibold"
            >
              Start researching →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
