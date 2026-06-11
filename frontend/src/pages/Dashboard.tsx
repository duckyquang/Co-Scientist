import { Link } from "react-router-dom";
import { api } from "../api";
import { Sparkline } from "../components/charts";
import { Empty, Loader, Progress, Stat, StatusBadge } from "../components/ui";
import { eloColor, fmtUsd, timeAgo } from "../lib/format";
import { IS_STATIC_DEMO } from "../lib/config";
import { getDeploymentMode } from "../lib/credentials";
import { canUseLiveApi } from "../lib/live";
import { usePoll } from "../lib/hooks";
import type { GlobalStats, SessionRow } from "../types";

function SessionCard({ s }: { s: SessionRow }) {
  const pct = s.budget_usd > 0 ? (s.budget_used_usd / s.budget_usd) * 100 : 0;
  return (
    <Link to={`/s/${s.id}`} className="card card-hover group block p-5 animate-fade-up">
      <div className="flex items-start justify-between gap-3">
        <StatusBadge status={s.status} />
        <span className="text-[11px] text-slate-500">{timeAgo(s.updated_at)}</span>
      </div>
      <h3 className="mt-3 line-clamp-2 text-[15px] font-semibold leading-snug text-slate-100 group-hover:text-white">
        {s.research_goal}
      </h3>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-lg font-bold text-white">{s.n_hyps}</div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">hypotheses</div>
        </div>
        <div>
          <div className={`text-lg font-bold ${eloColor(s.top_elo)}`}>
            {s.top_elo ? Math.round(s.top_elo) : "—"}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">top elo</div>
        </div>
        <div>
          <div className="text-lg font-bold text-white">{s.n_matches}</div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">matches</div>
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-[11px] text-slate-400">
          <span>{fmtUsd(s.budget_used_usd)} / {fmtUsd(s.budget_usd)}</span>
          <span>{pct.toFixed(0)}%</span>
        </div>
        <Progress value={s.budget_used_usd} max={s.budget_usd} />
      </div>
    </Link>
  );
}

function Hero({ stats }: { stats: GlobalStats | null }) {
  return (
    <div className="card grid-bg relative mb-7 overflow-hidden p-8">
      <div className="relative z-10 max-w-2xl">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-semibold text-brand-300">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-400 animate-pulseDot" />
          Multi-agent research engine
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Turn a research goal into a{" "}
          <span className="bg-gradient-to-r from-brand-400 to-flux-400 bg-clip-text text-transparent">
            tournament-ranked
          </span>{" "}
          set of novel hypotheses.
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-slate-400">
          Generation, Reflection, Ranking, Evolution, Proximity and Meta-review agents collaborate
          through an Elo tournament — watch it unfold live.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/new" className="btn-primary">✨ Start a session</Link>
          <a href="#sessions" className="btn-ghost">Browse sessions</a>
        </div>
      </div>
      {stats && (
        <div className="relative z-10 mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:max-w-2xl">
          {[
            { k: "Sessions", v: stats.n_sessions, accent: "#818cf8" },
            { k: "Hypotheses", v: stats.n_hypotheses, accent: "#22d3ee" },
            { k: "Matches", v: stats.n_matches, accent: "#f59e0b" },
            { k: "Total spend", v: fmtUsd(stats.total_cost_usd), accent: "#a855f7" },
          ].map((x) => (
            <div key={x.k} className="rounded-xl border border-white/[0.06] bg-ink-900/40 p-3">
              <div className="text-2xl font-bold" style={{ color: x.accent }}>{x.v}</div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500">{x.k}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { data: sessions, loading } = usePoll<SessionRow[]>(() => api.sessions(), [], 5000);
  const { data: stats } = usePoll<GlobalStats>(() => api.stats(), [], 5000);

  const running = (sessions || []).filter((s) => s.status === "running");
  const trend = (sessions || []).map((s) => s.n_hyps).slice(0, 12).reverse();

  return (
    <div>
      <Hero stats={stats} />

      {IS_STATIC_DEMO && !canUseLiveApi() && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-brand-500/20 bg-brand-500/[0.06] px-4 py-3 text-sm text-brand-200">
          <span>{getDeploymentMode() === "local" ? "💻" : "🌐"}</span>
          {getDeploymentMode() === "local"
            ? "Local mode selected — follow the setup guide to run on your machine, or browse the demo sessions below."
            : "Demo snapshot — add your API key in Settings to launch live sessions, or browse the samples below."}
        </div>
      )}

      {!IS_STATIC_DEMO && running.length > 0 && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3 text-sm text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulseDot" />
          {running.length} session{running.length > 1 ? "s" : ""} running right now — live updates streaming.
        </div>
      )}

      <div id="sessions" className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Research sessions</h2>
        {trend.length > 1 && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            output trend <Sparkline values={trend} width={90} height={26} />
          </div>
        )}
      </div>

      {loading && !sessions ? (
        <Loader label="Loading sessions" />
      ) : sessions && sessions.length === 0 ? (
        <Empty icon="🔬" title="No sessions yet" hint="Start your first research session to see the agents in action." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sessions!.map((s) => <SessionCard key={s.id} s={s} />)}
        </div>
      )}
    </div>
  );
}
