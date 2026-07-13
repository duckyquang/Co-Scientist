import type { LucideIcon } from "lucide-react";
import { FileText, Swords, FilePen, Check } from "lucide-react";
import { setDeploymentMode } from "../lib/credentials";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function OnboardingModal({ open, onClose }: Props) {
  if (!open) return null;

  function start() {
    setDeploymentMode("default"); // free path; also marks onboarding done
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 animate-fade-in">
      <div className="w-full max-w-lg animate-fade-up">
        <div className="card overflow-hidden">
          <div className="h-1 w-full" style={{ background: "var(--red)" }} />
          <div className="p-8">
            {/* Masthead */}
            <div className="mb-6 border-b border-rule pb-4">
              <div className="font-mono text-[13px] font-semibold uppercase tracking-[0.18em] text-ink">Co-Scientist</div>
              <div className="mt-1 tag">AI Research Engine</div>
            </div>

            <h2 className="font-serif text-2xl font-semibold leading-[1.15] text-ink">
              Turn any question into<br />
              <em className="italic text-accent">ranked research hypotheses.</em>
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              Six specialised AI agents generate, critique, and tournament-rank ideas
              — so you can focus on the research, not the grunt work.
            </p>

            {/* Feature bullets */}
            <div className="mt-6 space-y-3">
              {([
                [FilePen, "Write a research goal in plain English"],
                [Swords, "Agents debate and Elo-rank every hypothesis"],
                [FileText, "Get a final overview with the best findings"],
              ] as [LucideIcon, string][]).map(([Icon, text]) => (
                <div key={text} className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-blue" />
                  <span className="text-sm text-ink-soft">{text}</span>
                </div>
              ))}
            </div>

            {/* Zero-setup callout */}
            <div className="mt-6 flex items-center gap-3 border border-rule border-l-2 border-l-green bg-green-soft px-4 py-3">
              <Check className="h-5 w-5 shrink-0 text-green" />
              <p className="text-sm text-ink-soft">
                <span className="font-semibold text-green">No setup needed.</span>{" "}
                Start researching instantly — no API key, no account required.
              </p>
            </div>

            <button
              onClick={start}
              className="btn-primary mt-7 w-full py-3"
            >
              Start researching →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
