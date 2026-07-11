import { Trophy, Swords, GitBranch, Radar, FileText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { eloColor } from "../../lib/format";
import { StrategyTag } from "../ui";
import type { Hypothesis, Metrics } from "../../types";

const LEGEND: [LucideIcon, string, string][] = [
  [Trophy, "Elo rating", "Every hypothesis starts at 1200. It wins or loses Elo each time the Ranking agent pits it against another. Higher = it survived more debates."],
  [Swords, "Tournament", "The list of head-to-head matches and how each idea's rating moved over time."],
  [GitBranch, "Lineage", "How ideas evolved: original hypotheses on the left, offspring the Evolution agent bred from top parents on the right."],
  [Radar, "Clusters", "A map where ideas exploring the same theme sit close together — so you can see where the agents converged."],
];

/** Plain-language landing view: what happened, the top proposals, and a legend
 *  so the power tabs (tournament / lineage / clusters) stop being cryptic. */
export function Overview({
  metrics, hyps, overviewReady, onSelect, onOpenReport,
}: {
  metrics: Metrics;
  hyps: Hypothesis[];
  overviewReady: boolean;
  onSelect: (id: string) => void;
  onOpenReport: () => void;
}) {
  const ranked = [...hyps]
    .filter((h) => h.state !== "rejected" && h.elo != null)
    .sort((a, b) => (b.elo ?? 0) - (a.elo ?? 0));
  const top = ranked.slice(0, 3);
  const topTitle = top[0]?.title;

  return (
    <div className="space-y-6">
      {/* Headline — the one-sentence answer. Warm cream hero: the single
          "highlight" accent that draws the eye (Emil: beauty as leverage). */}
      <div className="card relative overflow-hidden border-warm-500/25 p-6">
        <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-warm-500/[0.10] blur-3xl" />
        <div className="pointer-events-none absolute inset-0 bg-warm-500/[0.035] dark:bg-warm-500/[0.05]" />
        <div className="relative">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-warm-400 ring-4 ring-warm-400/20" />
            <span className="label text-warm-700 dark:text-warm-300">What the agents found</span>
          </div>
          <p className="mt-3 text-[17px] leading-relaxed text-muted">
            Explored{" "}
            <span className="font-bold text-fg">{metrics.n_hypotheses} hypotheses</span>,{" "}
            ran{" "}
            <span className="font-bold text-fg">{metrics.n_matches} head-to-head matches</span>{" "}
            to rank them, and{" "}
            {topTitle ? (
              <>
                surfaced a leading idea:{" "}
                <button onClick={() => onSelect(top[0].id)}
                  className="font-semibold text-brand-600 dark:text-brand-300 underline decoration-brand-500/30 underline-offset-2 hover:text-brand-500">
                  {topTitle}
                </button>.
              </>
            ) : (
              <>are still building the first hypotheses.</>
            )}
          </p>
          {overviewReady && (
            <button onClick={onOpenReport} className="btn-primary mt-4 h-9 text-sm">
              <FileText className="h-4 w-4" /> Read the full research proposal
            </button>
          )}
        </div>
      </div>

      {/* Top proposals */}
      {top.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-bold text-fg">Top proposals</h2>
            <span className="text-[11px] text-faint">ranked by tournament Elo</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {top.map((h, i) => (
              <button key={h.id} onClick={() => onSelect(h.id)}
                style={{ animationDelay: `${i * 55}ms` }}
                className="card card-hover flex flex-col p-4 text-left animate-fade-up">
                <div className="flex items-center justify-between">
                  <span className="grid h-6 w-6 place-items-center rounded-lg bg-accent-500/15 text-[12px] font-bold text-accent-600 dark:text-accent-300">
                    {i + 1}
                  </span>
                  <span className={`text-lg font-bold ${eloColor(h.elo)}`}>
                    {h.elo ? Math.round(h.elo) : "—"}
                    <span className="ml-1 text-[9px] uppercase tracking-wider text-faint">elo</span>
                  </span>
                </div>
                <h3 className="mt-2.5 line-clamp-2 text-[14px] font-semibold leading-snug text-fg">
                  {h.title}
                </h3>
                <p className="mt-1.5 line-clamp-3 flex-1 text-[12px] leading-relaxed text-faint">
                  {h.summary}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <StrategyTag strategy={h.strategy} />
                  <span className="text-[10.5px] text-faint">{h.matches_played} matches</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Legend — how to read the rest of the session */}
      <div className="card p-5">
        <div className="label mb-3">How to read this session</div>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {LEGEND.map(([Icon, term, desc]) => (
            <div key={term} className="flex gap-2.5">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
              <div>
                <div className="text-[12.5px] font-semibold text-fg">{term}</div>
                <div className="text-[11.5px] leading-relaxed text-faint">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
