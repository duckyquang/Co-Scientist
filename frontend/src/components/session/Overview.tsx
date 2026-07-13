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
      <div className="card border-l-2 border-l-accent p-6">
        <div className="flex items-center gap-2">
          <span className="label text-accent">What the agents found</span>
        </div>
        <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink">
          Explored{" "}
          <span className="num font-bold">{metrics.n_hypotheses} hypotheses</span>,{" "}
          ran{" "}
          <span className="num font-bold">{metrics.n_matches} head-to-head matches</span>{" "}
          to rank them, and{" "}
          {topTitle ? (
            <>
              surfaced a leading idea:{" "}
              <button onClick={() => onSelect(top[0].id)}
                className="font-semibold text-blue underline underline-offset-2 hover:text-accent">
                {topTitle}
              </button>.
            </>
          ) : (
            <>are still building the first hypotheses.</>
          )}
        </p>
        {overviewReady && (
          <button onClick={onOpenReport} className="btn-primary mt-4 h-9">
            <FileText className="h-4 w-4" /> Read the full research proposal
          </button>
        )}
      </div>

      {/* Top proposals */}
      {top.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="font-serif text-base font-semibold text-ink">Top proposals</h2>
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">ranked by tournament Elo</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {top.map((h, i) => (
              <button key={h.id} onClick={() => onSelect(h.id)}
                style={{ animationDelay: `${i * 55}ms` }}
                className="card card-hover flex flex-col p-4 text-left animate-fade-up">
                <div className="flex items-center justify-between">
                  <span className="num grid h-6 w-6 place-items-center border border-rule text-[12px] font-bold text-accent">
                    {i + 1}
                  </span>
                  <span className={`num text-lg font-bold ${eloColor(h.elo)}`}>
                    {h.elo ? Math.round(h.elo) : "—"}
                    <span className="ml-1 font-mono text-[9px] uppercase tracking-[0.08em] text-ink-soft">elo</span>
                  </span>
                </div>
                <h3 className="mt-2.5 line-clamp-2 font-serif text-[14px] font-semibold leading-snug text-ink">
                  {h.title}
                </h3>
                <p className="mt-1.5 line-clamp-3 flex-1 text-[12px] leading-relaxed text-ink-soft">
                  {h.summary}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <StrategyTag strategy={h.strategy} />
                  <span className="num text-[10.5px] text-ink-soft">{h.matches_played} matches</span>
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
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-blue" />
              <div>
                <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink">{term}</div>
                <div className="text-[11.5px] leading-relaxed text-ink-soft">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
