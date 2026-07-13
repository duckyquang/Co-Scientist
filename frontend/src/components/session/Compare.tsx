import { useEffect, useState } from "react";
import { Scale, X } from "lucide-react";
import { api } from "../../api";
import { eloColor } from "../../lib/format";
import { ScoreBars } from "../charts";
import { Loader, Markdown, StateBadge, StrategyTag } from "../ui";
import type { Hypothesis } from "../../types";

function Column({ h }: { h: Hypothesis | null }) {
  if (!h) return <div className="flex h-full items-center justify-center p-8"><Loader /></div>;
  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <StateBadge state={h.state} />
        <StrategyTag strategy={h.strategy} />
        <span className="chip chip-mute">{h.created_by}</span>
      </div>
      <h3 className="font-serif text-lg font-semibold leading-tight text-ink">{h.title}</h3>
      <div className="flex items-baseline gap-4">
        <div>
          <span className={`num text-2xl font-bold ${eloColor(h.elo)}`}>{h.elo ? Math.round(h.elo) : "—"}</span>
          <span className="ml-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">Elo</span>
        </div>
        <div className="num text-xs text-ink-soft">{h.matches_played} matches · {h.reviews?.length ?? 0} reviews</div>
      </div>
      <p className="text-[13px] leading-relaxed text-ink-soft">{h.summary}</p>
      <div className="card p-4">
        <div className="label mb-3">Scores</div>
        <ScoreBars scores={h.scores} />
      </div>
      <details className="card p-4">
        <summary className="label cursor-pointer">Full hypothesis</summary>
        <div className="mt-3"><Markdown md={h.full_text} /></div>
      </details>
    </div>
  );
}

/** Side-by-side comparison of two hypotheses. */
export function Compare({
  sessionId, aId, bId, onClose,
}: { sessionId: string; aId: string; bId: string; onClose: () => void }) {
  const [a, setA] = useState<Hypothesis | null>(null);
  const [b, setB] = useState<Hypothesis | null>(null);

  useEffect(() => {
    setA(null); setB(null);
    api.hypothesis(sessionId, aId).then(setA).catch(() => {});
    api.hypothesis(sessionId, bId).then(setB).catch(() => {});
  }, [sessionId, aId, bId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const eloDiff = a?.elo != null && b?.elo != null ? Math.round(a.elo - b.elo) : null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 animate-fade-in" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden border border-rule bg-card animate-fade-up"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 font-serif text-sm font-semibold text-ink"><Scale className="h-4 w-4" /> Compare hypotheses</span>
            {eloDiff != null && (
              <span className="chip chip-mute num">
                Δ Elo {eloDiff > 0 ? `+${eloDiff} (left)` : eloDiff < 0 ? `${eloDiff} (right)` : "tied"}
              </span>
            )}
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center border border-transparent text-ink-soft hover:border-rule hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid flex-1 grid-cols-1 divide-y divide-rule overflow-y-auto md:grid-cols-2 md:divide-x md:divide-y-0">
          <Column h={a} />
          <Column h={b} />
        </div>
      </div>
    </div>
  );
}
