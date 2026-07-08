import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Sparkles, Trophy, Swords, GitBranch, Radar, BarChart3, Radio, FileText,
  Ban, Pause, Play, Square, Scale,
} from "lucide-react";
import { api } from "../api";
import {
  ActivityFeed, AnalyticsPanel, FeedbackPanel, Leaderboard, OverviewPanel, TournamentPanel,
} from "../components/session/panels";
import { ClusterMap } from "../components/session/ClusterMap";
import { Compare } from "../components/session/Compare";
import { HypothesisDrawer } from "../components/session/HypothesisDrawer";
import { LineageGraph } from "../components/session/LineageGraph";
import { Overview } from "../components/session/Overview";
import { Loader, Progress, StatusBadge } from "../components/ui";
import { fmtCompact, fmtDuration, fmtUsd } from "../lib/format";
import { useSessionStream, usePoll } from "../lib/hooks";
import type {
  ClusterPoint, CostByAgent, Feedback, Hypothesis, LineageNode, Match, SessionDetail,
} from "../types";

interface Bundle {
  detail: SessionDetail;
  hyps: Hypothesis[];
  matches: Match[];
  cost: { by_agent: CostByAgent[]; summary: any };
  feedback: Feedback[];
  lineage: { nodes: LineageNode[]; edges: { source: string; target: string }[] };
  clusters: ClusterPoint[];
  eloHistory: Record<string, { i: number; elo: number }[]>;
}

const TABS = [
  { id: "overview", label: "Overview", icon: Sparkles },
  { id: "leaderboard", label: "Leaderboard", icon: Trophy },
  { id: "tournament", label: "Tournament", icon: Swords },
  { id: "lineage", label: "Lineage", icon: GitBranch },
  { id: "clusters", label: "Clusters", icon: Radar },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "activity", label: "Activity", icon: Radio },
  { id: "report", label: "Final report", icon: FileText },
] as const;

type TabId = (typeof TABS)[number]["id"];

function Gauge({ label, used, total, fmt, color }: {
  label: string; used: number; total: number; fmt: (n: number) => string; color: string;
}) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className="min-w-[180px] flex-1">
      <div className="mb-1 flex justify-between text-[11px]">
        <span className="text-faint">{label}</span>
        <span className="font-semibold text-muted">{fmt(used)} / {fmt(total)}</span>
      </div>
      <Progress value={used} max={total} color={color} />
    </div>
  );
}

function MetricChip({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-2.5">
      <div className="text-lg font-bold leading-none" style={accent ? { color: accent } : undefined}>{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-faint">{label}</div>
    </div>
  );
}

export default function Session() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<TabId>("overview");
  const [selected, setSelected] = useState<string | null>(null);
  const [overview, setOverview] = useState<string | null>(null);
  const [compareBase, setCompareBase] = useState<string | null>(null);
  const [comparePair, setComparePair] = useState<[string, string] | null>(null);
  const [busy, setBusy] = useState(false);

  const { events, tick, connected } = useSessionStream(id);

  const fetchAll = useCallback(async (): Promise<Bundle> => {
    const sid = id!;
    const [detail, hyps, matches, cost, feedback, lineage, clusters, eloHistory] = await Promise.all([
      api.session(sid), api.hypotheses(sid), api.matches(sid), api.cost(sid),
      api.feedback(sid), api.lineage(sid), api.clusters(sid), api.eloHistory(sid),
    ]);
    return { detail, hyps, matches, cost, feedback, lineage, clusters, eloHistory };
  }, [id]);

  const { data, error, loading, refresh } = usePoll<Bundle>(fetchAll, [id], null);

  // Live refresh: every SSE tick re-pulls the bundle while the session runs.
  useEffect(() => { if (tick) refresh(); /* eslint-disable-next-line */ }, [tick]);

  const status = data?.detail.session.status;

  // Final report loads once the session has an overview / is done.
  useEffect(() => {
    if (!id) return;
    if (status === "done" || data?.detail.session.final_overview) {
      api.overview(id).then(setOverview).catch(() => {});
    }
  }, [id, status, data?.detail.session.final_overview]);

  async function control(action: "pause" | "resume" | "abort") {
    if (!id) return;
    if (action === "abort" && !window.confirm("Abort this session? Running agents will stop.")) return;
    setBusy(true);
    try { await api.control(id, action); await refresh(); }
    finally { setBusy(false); }
  }

  function onSelect(hid: string) {
    if (compareBase && compareBase !== hid) {
      setComparePair([compareBase, hid]);
      setCompareBase(null);
      setSelected(null);
      return;
    }
    setSelected(hid);
  }

  const live = status === "running";
  const session = data?.detail.session;
  const metrics = data?.detail.metrics;

  const tokenUsed = (metrics?.input_tokens || 0) + (metrics?.output_tokens || 0);
  const stateCounts = data?.detail.counts.hypothesis_states || {};

  // Elapsed run time: to now while live, else frozen at last update.
  const startMs = session ? new Date(session.created_at).getTime() : 0;
  const endMs = live ? Date.now() : (session ? new Date(session.updated_at).getTime() : 0);
  const elapsedSec = startMs ? Math.max(0, (endMs - startMs) / 1000) : 0;

  const overviewReady = !!(overview || session?.final_overview);

  const tabsWithBadges = useMemo(() => TABS.map((t) => {
    let badge: number | null = null;
    if (t.id === "leaderboard") badge = data?.hyps.length ?? null;
    else if (t.id === "tournament") badge = data?.matches.length ?? null;
    else if (t.id === "activity") badge = events.length || null;
    return { ...t, badge };
  }), [data, events.length]);

  if (loading && !data) {
    return <div className="py-16"><Loader label="Loading research session" /></div>;
  }
  if (error && !data) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <Ban className="mx-auto h-9 w-9 text-faint" strokeWidth={1.5} />
        <h2 className="mt-3 text-lg font-bold text-fg">Session not found</h2>
        <p className="mt-1 text-sm text-muted">{error}</p>
        <Link to="/" className="btn-ghost mt-5 inline-flex">← Back to dashboard</Link>
      </div>
    );
  }
  if (!data || !session || !metrics) return null;

  return (
    <div className="animate-fade-up">
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="card relative overflow-hidden p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <StatusBadge status={session.status} />
              <span className={`inline-flex items-center gap-1.5 text-[11px] ${connected ? "text-blue-400" : "text-faint"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-blue-500 animate-pulseDot" : "bg-slate-600"}`} />
                {connected ? "live stream connected" : "stream idle"}
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-extrabold leading-tight tracking-tight text-fg">
              {session.research_goal}
            </h1>
            {session.research_plan?.objective && (
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
                {session.research_plan.objective}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            {live && (
              <button disabled={busy} onClick={() => control("pause")} className="btn-ghost h-9"><Pause className="h-4 w-4" /> Pause</button>
            )}
            {status === "paused" && (
              <button disabled={busy} onClick={() => control("resume")} className="btn-primary h-9"><Play className="h-4 w-4" /> Resume</button>
            )}
            {(live || status === "paused") && (
              <button disabled={busy} onClick={() => control("abort")} className="btn-ghost h-9 text-muted"><Square className="h-3.5 w-3.5" /> Abort</button>
            )}
          </div>
        </div>

        {/* gauges — token cap + time limit (dollars retired) */}
        <div className="mt-6 flex flex-wrap gap-6">
          <Gauge label="Tokens used" used={tokenUsed} total={session.budget_tokens || tokenUsed || 1}
            fmt={(n) => fmtCompact(n)} color="#60a5fa" />
          <Gauge label="Run time" used={elapsedSec} total={session.wall_clock_seconds || elapsedSec || 1}
            fmt={fmtDuration} color="#34d399" />
        </div>

        {/* metric strip — grouped, dollars demoted to a hint */}
        <div className="mt-5 flex flex-wrap gap-2.5">
          <MetricChip label="Hypotheses" value={metrics.n_hypotheses} accent="#3b82f6" />
          <MetricChip label="In tournament" value={metrics.n_in_tournament} accent="#60a5fa" />
          <MetricChip label="Matches" value={metrics.n_matches} accent="#34d399" />
          <MetricChip label="Reviewed" value={metrics.n_reviewed} accent="#93c5fd" />
          <MetricChip label="Pinned" value={stateCounts.pinned || metrics.n_pinned || 0} accent="#34d399" />
          <MetricChip label="LLM calls" value={metrics.n_calls} />
        </div>
        {metrics.cost_usd > 0 && (
          <div className="mt-2 text-[11px] text-faint">
            Estimated compute cost: {fmtUsd(metrics.cost_usd)} · free to you
          </div>
        )}
      </div>

      {/* compare-mode banner */}
      {compareBase && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-blue-500/30 bg-blue-500/[0.08] px-4 py-2.5 text-sm text-blue-700 dark:text-blue-200">
          <span className="flex items-center gap-2"><Scale className="h-4 w-4" /> Compare mode — pick another hypothesis to compare against the selected one.</span>
          <button onClick={() => setCompareBase(null)} className="text-blue-600 dark:text-blue-300 hover:text-fg">Cancel</button>
        </div>
      )}

      {/* ── Tabs ─────────────────────────────────────────────── */}
      <div className="mt-6 flex flex-wrap gap-1.5 border-b border-line pb-px">
        {tabsWithBadges.map((t) => {
          const active = tab === t.id;
          const disabled = t.id === "report" && !overviewReady;
          return (
            <button key={t.id} disabled={disabled}
              onClick={() => setTab(t.id)}
              className={`relative flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-medium transition ${
                active ? "bg-surface-2 text-fg"
                  : disabled ? "cursor-not-allowed text-faint"
                  : "text-muted hover:text-fg"
              }`}>
              <t.icon className="h-4 w-4" />{t.label}
              {t.badge != null && (
                <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-muted">{t.badge}</span>
              )}
              {active && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand-500" />}
            </button>
          );
        })}
      </div>

      {/* ── Tab content ──────────────────────────────────────── */}
      <div className="mt-6">
        {tab === "overview" && (
          <Overview
            metrics={metrics}
            hyps={data.hyps}
            overviewReady={overviewReady}
            onSelect={onSelect}
            onOpenReport={() => setTab("report")}
          />
        )}
        {tab === "leaderboard" && (
          <Leaderboard hyps={data.hyps} onSelect={onSelect} eloSeries={data.eloHistory} />
        )}
        {tab === "tournament" && (
          <TournamentPanel matches={data.matches} eloSeries={data.eloHistory}
            onSelect={onSelect} highlight={selected || undefined} />
        )}
        {tab === "lineage" && (
          <div className="card p-4">
            <LineageGraph nodes={data.lineage.nodes} edges={data.lineage.edges} onSelect={onSelect} />
          </div>
        )}
        {tab === "clusters" && (
          <div className="card p-5">
            <ClusterMap points={data.clusters} onSelect={onSelect} />
          </div>
        )}
        {tab === "analytics" && (
          <AnalyticsPanel byAgent={data.cost.by_agent} summary={data.cost.summary} />
        )}
        {tab === "activity" && (
          <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
            <ActivityFeed events={events} live={live} />
            <FeedbackPanel sessionId={id!} feedback={data.feedback} onSent={refresh} />
          </div>
        )}
        {tab === "report" && <OverviewPanel md={overview || session.final_overview} />}
      </div>

      {/* drawer + compare overlays */}
      {selected && (
        <HypothesisDrawer
          sessionId={id!} hid={selected}
          onClose={() => setSelected(null)}
          onChanged={refresh}
          onCompare={(hid) => { setSelected(null); setCompareBase(hid); }}
        />
      )}
      {comparePair && (
        <Compare sessionId={id!} aId={comparePair[0]} bId={comparePair[1]}
          onClose={() => setComparePair(null)} />
      )}
    </div>
  );
}
