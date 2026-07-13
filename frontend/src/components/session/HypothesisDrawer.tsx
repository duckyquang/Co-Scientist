import { useEffect, useState } from "react";
import { Pin, X, Undo2, Swords } from "lucide-react";
import { api } from "../../api";
import { eloColor, timeAgo } from "../../lib/format";
import { ScoreRadar, Sparkline } from "../charts";
import { Loader, Markdown, StateBadge, StrategyTag } from "../ui";
import type { Hypothesis } from "../../types";

const VERDICT_STYLE: Record<string, string> = {
  neutral: "text-ink-soft",
  missing_piece: "text-green",
  already_explained: "text-ink-soft",
  other_more_likely: "text-blue",
  disproved: "text-accent",
};

export function HypothesisDrawer({
  sessionId, hid, onClose, onChanged, onCompare,
}: {
  sessionId: string; hid: string; onClose: () => void;
  onChanged: () => void; onCompare: (id: string) => void;
}) {
  const [h, setH] = useState<Hypothesis | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.hypothesis(sessionId, hid).then(setH).catch(() => {});
  useEffect(() => { setH(null); load(); /* eslint-disable-next-line */ }, [hid, sessionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function setState(state: string) {
    setBusy(true);
    try {
      await api.setHypState(sessionId, hid, state);
      await load();
      onChanged();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 animate-fade-in" onClick={onClose}>
      <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-rule bg-card animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}>
        {!h ? (
          <div className="p-8"><Loader /></div>
        ) : (
          <div className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <StateBadge state={h.state} />
                <StrategyTag strategy={h.strategy} />
                <span className="chip chip-mute">{h.created_by}</span>
              </div>
              <button onClick={onClose} className="grid h-8 w-8 place-items-center border border-transparent text-ink-soft hover:border-rule hover:text-ink"><X className="h-4 w-4" /></button>
            </div>

            <h2 className="mt-4 font-serif text-xl font-semibold leading-tight text-ink">{h.title}</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">{h.summary}</p>

            {/* metric strip */}
            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="card p-3 text-center">
                <div className={`num text-2xl font-bold ${eloColor(h.elo)}`}>{h.elo ? Math.round(h.elo) : "—"}</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">Elo rating</div>
              </div>
              <div className="card p-3 text-center">
                <div className="num text-2xl font-bold text-ink">{h.matches_played}</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">Matches</div>
              </div>
              <div className="card p-3 text-center">
                <div className="num text-2xl font-bold text-ink">{h.reviews?.length ?? 0}</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">Reviews</div>
              </div>
            </div>

            {/* actions */}
            <div className="mt-4 flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => setState("pinned")} className="btn-ghost h-9 text-green"><Pin className="h-3.5 w-3.5" /> Pin</button>
              <button disabled={busy} onClick={() => setState("rejected")} className="btn-danger h-9"><X className="h-3.5 w-3.5" /> Reject</button>
              <button disabled={busy} onClick={() => setState("in_tournament")} className="btn-ghost h-9"><Undo2 className="h-3.5 w-3.5" /> Reinstate</button>
              <button onClick={() => onCompare(h.id)} className="btn-ghost h-9"><Swords className="h-3.5 w-3.5" /> Compare</button>
            </div>

            {/* scores */}
            {(h.elo_history?.length || 0) > 1 && (
              <div className="mt-6">
                <div className="label mb-2">Elo trajectory</div>
                <Sparkline values={h.elo_history!.map((p) => p.elo)} width={560} height={56} />
              </div>
            )}

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <div className="card flex items-center justify-center p-4">
                <ScoreRadar scores={h.scores} size={190} />
              </div>
              <div className="card p-4">
                <div className="label mb-3">Reviewer verdicts</div>
                {h.reviews && h.reviews.length > 0 ? (
                  <div className="space-y-3">
                    {h.reviews.map((r) => (
                      <div key={r.id} className="border border-rule p-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono uppercase text-ink-soft">{r.kind}</span>
                          <span className={`font-mono font-semibold ${VERDICT_STYLE[r.verdict || "neutral"]}`}>
                            {(r.verdict || "neutral").replace("_", " ")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div className="text-sm text-ink-soft">Not yet reviewed.</div>}
              </div>
            </div>

            {/* citations */}
            {h.citations && h.citations.length > 0 && (
              <div className="mt-6">
                <div className="label mb-2">Citations ({h.citations.length})</div>
                <div className="space-y-2">
                  {h.citations.map((c, i) => (
                    <a key={i} href={c.url} target="_blank" rel="noreferrer"
                      className="block border border-rule bg-card p-3 transition-colors hover:border-blue">
                      <div className="font-serif text-sm font-medium text-ink">{c.title}</div>
                      {c.excerpt && <div className="mt-1 font-serif text-[12px] italic text-ink-soft">“{c.excerpt}”</div>}
                      <div className="mt-1 font-mono text-[10.5px] text-ink-soft">{c.doi} · {c.year}</div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* full text */}
            <div className="mt-6">
              <details open>
                <summary className="label cursor-pointer">Full hypothesis</summary>
                <div className="mt-3 card p-4"><Markdown md={h.full_text} /></div>
              </details>
            </div>

            {/* reviewer bodies */}
            {h.reviews && h.reviews.length > 0 && (
              <div className="mt-6">
                <div className="label mb-2">Detailed reviews</div>
                <div className="space-y-3">
                  {h.reviews.map((r) => (
                    <details key={r.id} className="card p-4">
                      <summary className="cursor-pointer font-serif text-sm font-semibold text-ink">
                        {r.kind} review · {timeAgo(r.created_at)}
                      </summary>
                      <div className="mt-3"><Markdown md={r.body} /></div>
                    </details>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
