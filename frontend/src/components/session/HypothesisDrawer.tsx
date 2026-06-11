import { useEffect, useState } from "react";
import { api } from "../../api";
import { eloColor, timeAgo } from "../../lib/format";
import { ScoreRadar, Sparkline } from "../charts";
import { Loader, Markdown, StateBadge, StrategyTag } from "../ui";
import type { Hypothesis } from "../../types";

const VERDICT_STYLE: Record<string, string> = {
  neutral: "text-slate-300",
  missing_piece: "text-amber-300",
  already_explained: "text-cyber-400",
  other_more_likely: "text-flux-400",
  disproved: "text-rose-400",
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
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-ink-900/95 shadow-2xl animate-fade-up"
        onClick={(e) => e.stopPropagation()}>
        {!h ? (
          <div className="p-8"><Loader /></div>
        ) : (
          <div className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <StateBadge state={h.state} />
                <StrategyTag strategy={h.strategy} />
                <span className="chip bg-white/5 text-slate-400">{h.created_by}</span>
              </div>
              <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10 text-slate-400">✕</button>
            </div>

            <h2 className="mt-4 text-xl font-bold leading-tight text-white">{h.title}</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-slate-300">{h.summary}</p>

            {/* metric strip */}
            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="card p-3 text-center">
                <div className={`text-2xl font-bold ${eloColor(h.elo)}`}>{h.elo ? Math.round(h.elo) : "—"}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Elo rating</div>
              </div>
              <div className="card p-3 text-center">
                <div className="text-2xl font-bold text-white">{h.matches_played}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Matches</div>
              </div>
              <div className="card p-3 text-center">
                <div className="text-2xl font-bold text-white">{h.reviews?.length ?? 0}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Reviews</div>
              </div>
            </div>

            {/* actions */}
            <div className="mt-4 flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => setState("pinned")} className="btn-ghost h-9 text-amber-300">📌 Pin</button>
              <button disabled={busy} onClick={() => setState("rejected")} className="btn-ghost h-9 text-rose-300">✕ Reject</button>
              <button disabled={busy} onClick={() => setState("in_tournament")} className="btn-ghost h-9">↩ Reinstate</button>
              <button onClick={() => onCompare(h.id)} className="btn-ghost h-9">⚖ Compare</button>
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
                      <div key={r.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-mono uppercase text-slate-400">{r.kind}</span>
                          <span className={`font-semibold ${VERDICT_STYLE[r.verdict || "neutral"]}`}>
                            {(r.verdict || "neutral").replace("_", " ")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div className="text-sm text-slate-500">Not yet reviewed.</div>}
              </div>
            </div>

            {/* citations */}
            {h.citations && h.citations.length > 0 && (
              <div className="mt-6">
                <div className="label mb-2">Citations ({h.citations.length})</div>
                <div className="space-y-2">
                  {h.citations.map((c, i) => (
                    <a key={i} href={c.url} target="_blank" rel="noreferrer"
                      className="block rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 transition hover:border-brand-500/40">
                      <div className="text-sm font-medium text-slate-200">{c.title}</div>
                      {c.excerpt && <div className="mt-1 text-[12px] italic text-slate-500">“{c.excerpt}”</div>}
                      <div className="mt-1 text-[11px] text-slate-600">{c.doi} · {c.year}</div>
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
                      <summary className="cursor-pointer text-sm font-semibold text-slate-200">
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
