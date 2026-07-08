import { eloColor } from "../../lib/format";
import { StrategyTag } from "../ui";
import type { Hypothesis, Metrics } from "../../types";

/** Plain-language landing view: what happened, the top proposals, and a legend
 *  so the power tabs (tournament / lineage / clusters) stop being cryptic. */
export function Overview({
  goal, metrics, hyps, overviewReady, onSelect, onOpenReport,
}: {
  goal: string;
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
      {/* Headline — the one-sentence answer */}
      <div className="card relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-accent-500/[0.07] blur-3xl" />
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-accent-400 shadow-glowAccent" />
          <span className="label text-accent-400">What the agents found</span>
        </div>
        <p className="mt-3 text-[17px] leading-relaxed text-slate-200">
          Explored{" "}
          <span className="font-bold text-white">{metrics.n_hypotheses} hypotheses</span>,{" "}
          ran{" "}
          <span className="font-bold text-white">{metrics.n_matches} head-to-head matches</span>{" "}
          to rank them, and{" "}
          {topTitle ? (
            <>
              surfaced a leading idea:{" "}
              <button onClick={() => onSelect(top[0].id)}
                className="font-semibold text-accent-300 underline decoration-accent-500/30 underline-offset-2 hover:text-accent-200">
                {topTitle}
              </button>.
            </>
          ) : (
            <>are still building the first hypotheses.</>
          )}
        </p>
        {overviewReady && (
          <button onClick={onOpenReport}
            className="btn-primary mt-4 h-9 bg-accent-600 hover:bg-accent-500 text-sm">
            📄 Read the full research proposal
          </button>
        )}
      </div>

      {/* Top proposals */}
      {top.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-bold text-white">Top proposals</h2>
            <span className="text-[11px] text-slate-500">ranked by tournament Elo</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {top.map((h, i) => (
              <button key={h.id} onClick={() => onSelect(h.id)}
                className="card card-hover flex flex-col p-4 text-left">
                <div className="flex items-center justify-between">
                  <span className="grid h-6 w-6 place-items-center rounded-lg bg-accent-500/15 text-[12px] font-bold text-accent-300">
                    {i + 1}
                  </span>
                  <span className={`text-lg font-bold ${eloColor(h.elo)}`}>
                    {h.elo ? Math.round(h.elo) : "—"}
                    <span className="ml-1 text-[9px] uppercase tracking-wider text-slate-600">elo</span>
                  </span>
                </div>
                <h3 className="mt-2.5 line-clamp-2 text-[14px] font-semibold leading-snug text-slate-100">
                  {h.title}
                </h3>
                <p className="mt-1.5 line-clamp-3 flex-1 text-[12px] leading-relaxed text-slate-500">
                  {h.summary}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <StrategyTag strategy={h.strategy} />
                  <span className="text-[10.5px] text-slate-600">{h.matches_played} matches</span>
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
          {[
            ["🏆", "Elo rating", "Every hypothesis starts at 1200. It wins or loses Elo each time the Ranking agent pits it against another. Higher = it survived more debates."],
            ["⚔️", "Tournament", "The list of head-to-head matches and how each idea's rating moved over time."],
            ["🌱", "Lineage", "How ideas evolved: original hypotheses on the left, offspring the Evolution agent bred from top parents on the right."],
            ["🛰️", "Clusters", "A map where ideas exploring the same theme sit close together — so you can see where the agents converged."],
          ].map(([icon, term, desc]) => (
            <div key={term} className="flex gap-2.5">
              <span className="mt-px shrink-0 text-base">{icon}</span>
              <div>
                <div className="text-[12.5px] font-semibold text-slate-200">{term}</div>
                <div className="text-[11.5px] leading-relaxed text-slate-500">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
