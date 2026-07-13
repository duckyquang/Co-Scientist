import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, FlaskConical, ClipboardList, Copy, Printer, Globe } from "lucide-react";
import { api } from "../../api";
import {
  agentColor, clockTime, eloColor, fmtCompact, fmtUsd, timeAgo,
} from "../../lib/format";
import { Donut, EloRace } from "../charts";
import { AgentTag, Empty, Markdown, StateBadge, StrategyTag } from "../ui";
import type {
  CostByAgent, Feedback, Hypothesis, Match, SSEvent,
} from "../../types";

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
          <summary className="cursor-pointer font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-soft">
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
      className="card card-hover flex w-full items-center gap-4 p-3.5 text-left">
      <div className="w-8 shrink-0 text-center">
        {rank > 0
          ? <span className={`num text-lg font-bold ${rank <= 3 ? "text-accent" : "text-ink-soft"}`}>{rank}</span>
          : <span className="text-ink-soft">—</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-serif text-[15px] font-semibold text-ink">{h.title}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <StateBadge state={h.state} />
          <StrategyTag strategy={h.strategy} />
          <span className="num text-[11px] text-ink-soft">{h.matches_played} matches · {h.n_reviews ?? 0} reviews</span>
        </div>
      </div>
      {spark && spark.length > 1 && (
        <div className="hidden sm:block">
          <MiniSpark values={spark.map((p) => p.elo)} />
        </div>
      )}
      <div className="w-16 shrink-0 text-right">
        <div className={`num text-xl font-bold ${eloColor(h.elo)}`}>{h.elo ? Math.round(h.elo) : "—"}</div>
        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">elo</div>
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
      <path d={d} fill="none" stroke={up ? "var(--green)" : "var(--red)"} strokeWidth="1.6" />
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
          <div className="text-sm text-ink-soft">No tournament matches yet.</div>
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
      className={`min-w-0 flex-1 truncate border px-2.5 py-1.5 text-left text-[13px] transition-colors ${
        won ? "border-green bg-green-soft text-green" : "border-rule text-ink-soft hover:text-ink"
      }`}>
      {won && <Check className="mr-0.5 inline h-3 w-3" />}{title || id.slice(0, 10)}
      {eloAfter != null && <span className="num ml-1 text-[11px] opacity-70">{Math.round(eloAfter)}</span>}
    </button>
  );
  return (
    <div className="border border-rule bg-card p-2.5">
      <div className="flex items-center gap-2">
        <Side id={m.hyp_a} title={m.title_a} won={aWon} eloAfter={m.elo_a_after} />
        <span className="tag shrink-0">{m.mode}</span>
        <Side id={m.hyp_b} title={m.title_b} won={!aWon && m.winner === "b"} eloAfter={m.elo_b_after} />
      </div>
      {m.rationale && <div className="mt-1.5 px-1 font-serif text-[12px] italic text-ink-soft">{m.rationale}</div>}
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
        <div className="label mb-3">Estimated cost by agent</div>
        <div className="flex items-center gap-6">
          <div className="relative">
            <Donut segments={segments} />
            <div className="absolute inset-0 grid place-items-center">
              <div className="text-center">
                <div className="num text-lg font-bold text-ink">{fmtUsd(total)}</div>
                <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">total</div>
              </div>
            </div>
          </div>
          <div className="flex-1 space-y-2">
            {byAgent.map((a) => (
              <div key={a.agent} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: agentColor(a.agent).hex }} />
                <span className="capitalize text-ink-soft">{a.agent}</span>
                <span className="num ml-auto text-ink">{fmtUsd(a.cost_usd)}</span>
                <span className="num w-10 text-right text-[11px] text-ink-soft">
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
          <TokenStat label="Input tokens" value={summary?.input_tokens} color="var(--chart-1)" />
          <TokenStat label="Output tokens" value={summary?.output_tokens} color="var(--chart-2)" />
          <TokenStat label="Cache reads" value={summary?.cache_read} color="var(--chart-3)" />
          <TokenStat label="LLM calls" value={summary?.n_calls} color="var(--chart-4)" raw />
        </div>
        <div className="mt-5 border-t border-rule pt-4">
          <div className="label mb-2">Per-agent call breakdown</div>
          <div className="space-y-1.5">
            {byAgent.map((a) => {
              const max = Math.max(...byAgent.map((x) => x.n_calls), 1);
              return (
                <div key={a.agent} className="flex items-center gap-2 text-xs">
                  <span className="w-20 capitalize text-ink-soft">{a.agent}</span>
                  <div className="h-2 flex-1 bg-[var(--grid)]">
                    <div className="h-full" style={{ width: `${(a.n_calls / max) * 100}%`, background: agentColor(a.agent).hex }} />
                  </div>
                  <span className="num w-8 text-right text-ink-soft">{a.n_calls}</span>
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
    <div className="border border-rule bg-card p-3">
      <div className="num text-xl font-bold" style={{ color }}>{raw ? value ?? 0 : fmtCompact(value)}</div>
      <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">{label}</div>
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

const DONE_EVENTS = new Set(["task_completed", "session_done", "match_complete"]);

export function ActivityFeed({ events, live }: { events: SSEvent[]; live: boolean }) {
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="label">Live activity</div>
        <span className={`chip ${live ? "chip-blue" : "chip-mute"}`}>
          {live && <span className="h-1.5 w-1.5 rounded-full bg-blue animate-pulseDot" />}
          {live ? "streaming" : "idle"}
        </span>
      </div>
      {events.length === 0 ? (
        <div className="py-8 text-center text-sm text-ink-soft">Waiting for events…</div>
      ) : (
        <div className="relative max-h-[560px] space-y-0 overflow-y-auto pl-1">
          {events.map((e, i) => {
            const label = EVENT_LABEL[e.event] || (() => e.event);
            const c = agentColor(e.agent);
            const done = DONE_EVENTS.has(e.event);
            return (
              <div key={`${e.id}-${i}`} className="relative flex gap-3 pb-3">
                <div className="flex flex-col items-center">
                  <span className={`tl-dot mt-1 ${done ? "tl-dot-done" : ""}`}
                    style={done ? undefined : { borderColor: c.hex }} />
                  {i < events.length - 1 && <span className="my-0.5 w-px flex-1 bg-rule" />}
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <div className="flex items-center gap-2">
                    {e.agent && <span className="font-mono text-[10.5px] uppercase tracking-[0.08em]" style={{ color: c.hex }}>{e.agent}</span>}
                    <span className="font-mono text-[10px] text-ink-soft">{e.ts ? clockTime(e.ts) : ""}</span>
                  </div>
                  <div className="font-serif text-[13px] leading-snug text-ink">{label(e.payload)}</div>
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
            <div key={f.id} className="flex items-start gap-3 border border-rule bg-card p-3 text-sm">
              <AgentTag agent={f.source === "meta_review" ? "metareview" : "human"} />
              <div className="flex-1">
                <span className="text-ink">{f.text}</span>
                <span className="ml-2 font-mono text-[10px] text-ink-soft">{timeAgo(f.created_at)}</span>
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
  const { id } = useParams<{ id: string }>();
  if (!md)
    return <Empty icon={ClipboardList} title="No final overview yet" hint="The Meta-review agent writes this once Elo ratings stabilize." />;
  return (
    <div className="card mx-auto max-w-[76ch] p-8 print:p-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 no-print">
        <div className="label">Final research overview</div>
        <div className="flex flex-wrap gap-2">
          {id && (
            <Link to={`/s/${id}/site`} className="btn-primary h-8">
              <Globe className="h-3.5 w-3.5" /> View as website
            </Link>
          )}
          <button className="btn-ghost h-8" onClick={() => {
            navigator.clipboard.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 1500);
          }}><Copy className="h-3.5 w-3.5" /> {copied ? "Copied!" : "Copy markdown"}</button>
          <button className="btn-ghost h-8" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" /> Print / PDF
          </button>
        </div>
      </div>
      <Markdown md={md} />
    </div>
  );
}
