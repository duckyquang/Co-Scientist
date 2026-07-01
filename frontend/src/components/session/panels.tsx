import { useMemo, useState } from "react";
import { Check, Dot, FlaskConical, ClipboardList } from "lucide-react";
import { api } from "../../api";
import {
  EVENT_ICON, agentColor, clockTime, eloColor, fmtCompact, fmtUsd, timeAgo,
} from "../../lib/format";
import { Donut, EloRace } from "../charts";
import { AgentTag, Empty, Markdown, StateBadge, StrategyTag } from "../ui";
import type {
  CostByAgent, Feedback, Hypothesis, Match, SSEvent,
} from "../../types";

const AGENT_ORDER = ["generation", "reflection", "ranking", "evolution", "metareview", "proximity", "supervisor"];

/* ----------------------------- Leaderboard ----------------------------- */
export function Leaderboard({
  hyps, onSelect, eloSeries,
}: {
  hyps: Hypothesis[];
  onSelect: (id: string) => void;
  eloSeries: Record<string, { i: number; elo: number }[]>;
}) {
  if (hyps.length === 0)
    return <Empty icon={FlaskConical} title="No hypotheses yet" hint="The Generation agent is working — they'll appear here." />;
  const ranked = [...hyps].filter((h) => h.state !== "rejected");
  const rejected = hyps.filter((h) => h.state === "rejected");
  return (
    <div className="space-y-2">
      {ranked.map((h, i) => (
        <Row key={h.id} h={h} rank={i + 1} onSelect={onSelect} spark={eloSeries[h.id]} />
      ))}
      {rejected.length > 0 && (
        <details className="pt-2">
          <summary className="cursor-pointer text-xs uppercase tracking-wider text-faint">
            {rejected.length} rejected
          </summary>
          <div className="mt-2 space-y-2 opacity-60">
            {rejected.map((h) => <Row key={h.id} h={h} rank={0} onSelect={onSelect} spark={eloSeries[h.id]} />)}
          </div>
        </details>
      )}
    </div>
  );
}

function Row({ h, rank, onSelect, spark }: {
  h: Hypothesis; rank: number; onSelect: (id: string) => void; spark?: { i: number; elo: number }[];
}) {
  return (
    <button onClick={() => onSelect(h.id)}
      className="card card-hover flex w-full items-center gap-4 p-3.5 text-left animate-fade-up">
      <div className="w-8 shrink-0 text-center">
        {rank > 0
          ? <span className={`text-lg font-bold ${rank <= 3 ? "text-blue-400" : "text-faint"}`}>{rank}</span>
          : <span className="text-faint">—</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-fg">{h.title}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <StateBadge state={h.state} />
          <StrategyTag strategy={h.strategy} />
          <span className="text-[11px] text-faint">{h.matches_played} matches · {h.n_reviews ?? 0} reviews</span>
        </div>
      </div>
      {spark && spark.length > 1 && (
        <div className="hidden sm:block">
          <MiniSpark values={spark.map((p) => p.elo)} />
        </div>
      )}
      <div className="w-16 shrink-0 text-right">
        <div className={`text-xl font-bold ${eloColor(h.elo)}`}>{h.elo ? Math.round(h.elo) : "—"}</div>
        <div className="text-[10px] uppercase tracking-wider text-faint">elo</div>
      </div>
    </button>
  );
}

function MiniSpark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const up = values[values.length - 1] >= values[0];
  const w = 70, ht = 26;
  const d = values.map((v, i) =>
    `${i ? "L" : "M"}${(i / (values.length - 1)) * w},${ht - ((v - min) / span) * ht}`).join(" ");
  return (
    <svg width={w} height={ht}>
      <path d={d} fill="none" stroke={up ? "#60a5fa" : "#52525b"} strokeWidth="1.6" />
    </svg>
  );
}

/* ----------------------------- Tournament ----------------------------- */
export function TournamentPanel({
  matches, eloSeries, onSelect, highlight,
}: {
  matches: Match[];
  eloSeries: Record<string, { i: number; elo: number }[]>;
  onSelect: (id: string) => void;
  highlight?: string;
}) {
  // Map hypothesis id → title (from match rows) so chart lines/legend are readable.
  const labels = useMemo(() => {
    const m: Record<string, string> = {};
    for (const x of matches) {
      if (x.title_a) m[x.hyp_a] = x.title_a;
      if (x.title_b) m[x.hyp_b] = x.title_b;
    }
    return m;
  }, [matches]);
  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="label mb-3">Elo race — rating over matches</div>
        <EloRace series={eloSeries} highlight={highlight} onSelect={onSelect} labels={labels} />
      </div>
      <div className="card p-5">
        <div className="label mb-3">Recent matches ({matches.length})</div>
        {matches.length === 0 ? (
          <div className="text-sm text-faint">No tournament matches yet.</div>
        ) : (
          <div className="space-y-2">
            {matches.slice(0, 40).map((m) => <MatchRow key={m.id} m={m} onSelect={onSelect} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function MatchRow({ m, onSelect }: { m: Match; onSelect: (id: string) => void }) {
  const aWon = m.winner === "a";
  const Side = ({ id, title, won, eloAfter }: { id: string; title?: string; won: boolean; eloAfter: number | null }) => (
    <button onClick={() => onSelect(id)}
      className={`min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 text-left text-[13px] transition ${
        won ? "bg-blue-500/10 text-blue-700 dark:text-blue-200 ring-1 ring-blue-500/20" : "bg-surface-2 text-muted"
      }`}>
      {won && <Check className="mr-0.5 inline h-3 w-3" />}{title || id.slice(0, 10)}
      {eloAfter != null && <span className="ml-1 font-mono text-[11px] opacity-70">{Math.round(eloAfter)}</span>}
    </button>
  );
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-2.5">
      <div className="flex items-center gap-2">
        <Side id={m.hyp_a} title={m.title_a} won={aWon} eloAfter={m.elo_a_after} />
        <span className="shrink-0 rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
          {m.mode}
        </span>
        <Side id={m.hyp_b} title={m.title_b} won={!aWon && m.winner === "b"} eloAfter={m.elo_b_after} />
      </div>
      {m.rationale && <div className="mt-1.5 px-1 text-[11px] italic text-faint">{m.rationale}</div>}
    </div>
  );
}

/* ----------------------------- Analytics ----------------------------- */
export function AnalyticsPanel({
  byAgent, summary,
}: { byAgent: CostByAgent[]; summary: any }) {
  const total = byAgent.reduce((s, a) => s + a.cost_usd, 0) || 1;
  const segments = byAgent.map((a) => ({
    value: a.cost_usd, color: agentColor(a.agent).hex, label: a.agent,
  }));
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card p-5">
        <div className="label mb-3">Spend by agent</div>
        <div className="flex items-center gap-6">
          <div className="relative">
            <Donut segments={segments} />
            <div className="absolute inset-0 grid place-items-center">
              <div className="text-center">
                <div className="text-lg font-bold text-fg">{fmtUsd(total)}</div>
                <div className="text-[10px] uppercase tracking-wider text-faint">total</div>
              </div>
            </div>
          </div>
          <div className="flex-1 space-y-2">
            {byAgent.map((a) => (
              <div key={a.agent} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: agentColor(a.agent).hex }} />
                <span className="capitalize text-muted">{a.agent}</span>
                <span className="ml-auto font-mono text-muted">{fmtUsd(a.cost_usd)}</span>
                <span className="w-10 text-right text-[11px] text-faint">
                  {((a.cost_usd / total) * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="label mb-3">Token usage</div>
        <div className="grid grid-cols-2 gap-4">
          <TokenStat label="Input tokens" value={summary?.input_tokens} color="#3b82f6" />
          <TokenStat label="Output tokens" value={summary?.output_tokens} color="#60a5fa" />
          <TokenStat label="Cache reads" value={summary?.cache_read} color="#93c5fd" />
          <TokenStat label="LLM calls" value={summary?.n_calls} color="#3b82f6" raw />
        </div>
        <div className="mt-5 border-t border-line pt-4">
          <div className="label mb-2">Per-agent call breakdown</div>
          <div className="space-y-1.5">
            {byAgent.map((a) => {
              const max = Math.max(...byAgent.map((x) => x.n_calls), 1);
              return (
                <div key={a.agent} className="flex items-center gap-2 text-xs">
                  <span className="w-20 capitalize text-muted">{a.agent}</span>
                  <div className="h-2 flex-1 rounded-full bg-surface-2">
                    <div className="h-full rounded-full" style={{ width: `${(a.n_calls / max) * 100}%`, background: agentColor(a.agent).hex }} />
                  </div>
                  <span className="w-8 text-right font-mono text-faint">{a.n_calls}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function TokenStat({ label, value, color, raw }: { label: string; value: number; color: string; raw?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <div className="text-xl font-bold" style={{ color }}>{raw ? value ?? 0 : fmtCompact(value)}</div>
      <div className="text-[10px] uppercase tracking-wider text-faint">{label}</div>
    </div>
  );
}

/* ----------------------------- Activity ----------------------------- */
const EVENT_LABEL: Record<string, (p: any) => string> = {
  session_started: () => "Session started",
  hypothesis_created: (p) => `New hypothesis: ${p?.title || ""}`,
  review_completed: () => "Hypothesis reviewed",
  match_complete: (p) => `Match (${p?.mode}) — ${p?.winner === "a" ? "A" : "B"} won`,
  task_started: (p) => `${p?.agent || "agent"} started ${p?.action || ""}`,
  task_completed: (p) => `Task done (${p?.kind || ""})`,
  task_failed: (p) => `Task failed: ${p?.err || ""}`,
  human_feedback: (p) => `Feedback (${p?.kind}): ${p?.text || ""}`,
  hypothesis_state_changed: (p) => `Marked ${p?.state}`,
  session_done: (p) => `Session complete — ${p?.stop_reason || ""}`,
  session_paused: () => "Session paused",
  session_running: () => "Session resumed",
  session_aborted: () => "Session aborted",
};

export function ActivityFeed({ events, live }: { events: SSEvent[]; live: boolean }) {
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="label">Live activity</div>
        <span className={`chip ${live ? "bg-blue-500/10 text-blue-400" : "bg-slate-500/15 text-muted"}`}>
          {live && <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulseDot" />}
          {live ? "streaming" : "idle"}
        </span>
      </div>
      {events.length === 0 ? (
        <div className="py-8 text-center text-sm text-faint">Waiting for events…</div>
      ) : (
        <div className="relative max-h-[560px] space-y-0 overflow-y-auto pl-1">
          {events.map((e, i) => {
            const label = EVENT_LABEL[e.event] || (() => e.event);
            const Icon = EVENT_ICON[e.event] || Dot;
            const c = agentColor(e.agent);
            return (
              <div key={`${e.id}-${i}`} className="relative flex gap-3 pb-3 animate-fade-up">
                <div className="flex flex-col items-center">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
                    style={{ background: c.hex + "22", border: `1px solid ${c.hex}55` }}>
                    <Icon className="h-3.5 w-3.5" style={{ color: c.hex }} />
                  </span>
                  {i < events.length - 1 && <span className="my-0.5 w-px flex-1 bg-surface-2" />}
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <div className="flex items-center gap-2">
                    {e.agent && <span className="text-[11px] font-semibold" style={{ color: c.hex }}>{e.agent}</span>}
                    <span className="text-[10px] text-faint">{e.ts ? clockTime(e.ts) : ""}</span>
                  </div>
                  <div className="text-[13px] leading-snug text-muted">{label(e.payload)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Feedback ----------------------------- */
export function FeedbackPanel({
  sessionId, feedback, onSent,
}: { sessionId: string; feedback: Feedback[]; onSent: () => void }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState("directive");
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.sendFeedback(sessionId, { text: text.trim(), kind });
      setText("");
      onSent();
    } finally { setBusy(false); }
  }
  return (
    <div className="card p-5">
      <div className="label mb-3">Researcher feedback</div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className="input flex-1" placeholder="Steer the agents — e.g. focus on metabolic pathways…"
          value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()} />
        <select className="input sm:w-40" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="directive">directive</option>
          <option value="preference">preference</option>
        </select>
        <button onClick={send} disabled={busy} className="btn-primary">Send</button>
      </div>
      {feedback.length > 0 && (
        <div className="mt-4 space-y-2">
          {feedback.map((f) => (
            <div key={f.id} className="flex items-start gap-3 rounded-lg border border-line bg-surface-2 p-3 text-sm">
              <AgentTag agent={f.source === "meta_review" ? "metareview" : "human"} />
              <div className="flex-1">
                <span className="text-muted">{f.text}</span>
                <span className="ml-2 text-[11px] text-faint">{timeAgo(f.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Overview ----------------------------- */
export function OverviewPanel({ md }: { md: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!md)
    return <Empty icon={ClipboardList} title="No final overview yet" hint="The Meta-review agent writes this once Elo ratings stabilize." />;
  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="label">Final research overview</div>
        <div className="flex gap-2">
          <button className="btn-ghost h-8 text-xs" onClick={() => {
            navigator.clipboard.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 1500);
          }}>{copied ? "Copied!" : "Copy markdown"}</button>
          <button className="btn-ghost h-8 text-xs" onClick={() => window.print()}>Print / PDF</button>
        </div>
      </div>
      <Markdown md={md} />
    </div>
  );
}
