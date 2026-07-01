import { useState } from "react";
import { Link } from "react-router-dom";
import { Microscope, Rocket } from "lucide-react";
import { api } from "../api";
import { Sparkline } from "../components/charts";
import { Loader, Progress, StatusBadge } from "../components/ui";
import { eloColor, fmtUsd, timeAgo } from "../lib/format";
import { usePoll } from "../lib/hooks";
import type { SessionRow } from "../types";

const EXAMPLE_PROMPTS = [
  "Identify novel drug-repurposing candidates for acute myeloid leukemia",
  "Propose mechanisms linking the gut microbiome to neuroinflammation",
  "Generate hypotheses for overcoming antibody resistance in HER2+ breast cancer",
  "Find testable strategies to extend the lifespan of human cardiac organoids",
];

function SessionCard({ s }: { s: SessionRow }) {
  const pct = s.budget_usd > 0 ? (s.budget_used_usd / s.budget_usd) * 100 : 0;
  return (
    <Link to={`/s/${s.id}`} className="card card-hover group block p-5 animate-fade-up">
      <div className="flex items-start justify-between gap-3">
        <StatusBadge status={s.status} />
        <span className="text-[11px] text-faint">{timeAgo(s.updated_at)}</span>
      </div>
      <h3 className="mt-3 line-clamp-2 text-[15px] font-semibold leading-snug text-fg group-hover:text-fg">
        {s.research_goal}
      </h3>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-lg font-bold text-fg">{s.n_hyps}</div>
          <div className="text-[10px] uppercase tracking-wider text-faint">hypotheses</div>
        </div>
        <div>
          <div className={`text-lg font-bold ${eloColor(s.top_elo)}`}>
            {s.top_elo ? Math.round(s.top_elo) : "—"}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-faint">top elo</div>
        </div>
        <div>
          <div className="text-lg font-bold text-fg">{s.n_matches}</div>
          <div className="text-[10px] uppercase tracking-wider text-faint">matches</div>
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-[11px] text-muted">
          <span>{fmtUsd(s.budget_used_usd)} / {fmtUsd(s.budget_usd)}</span>
          <span>{pct.toFixed(0)}%</span>
        </div>
        <Progress value={s.budget_used_usd} max={s.budget_usd} />
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="card flex flex-col items-center gap-6 px-8 py-14 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-blue-600/15 ring-1 ring-blue-500/25">
        <Microscope className="h-8 w-8 text-brand-400" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-fg">Start your first research session</h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
          Describe a scientific question and six AI agents will generate, debate, and
          Elo-rank novel hypotheses — live.
        </p>
      </div>
      <Link to="/new" className="btn-primary inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold">
        <Rocket className="h-4 w-4" /> Launch a session →
      </Link>
      <div className="w-full border-t border-line" />
      <div className="w-full max-w-lg text-left">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-faint">
          Try one of these prompts
        </div>
        <div className="space-y-2">
          {EXAMPLE_PROMPTS.map((p) => (
            <Link
              key={p}
              to={`/new?goal=${encodeURIComponent(p)}`}
              className="block rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-sm text-muted transition hover:border-blue-500/30 hover:bg-blue-500/[0.06] hover:text-fg"
            >
              {p}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: sessions, loading } = usePoll<SessionRow[]>(() => api.sessions(), [], 5000);
  const [showDemo, setShowDemo] = useState(false);

  const userSessions = (sessions || []).filter((s) => !s.id.startsWith("demo::"));
  const demoSessions = (sessions || []).filter((s) => s.id.startsWith("demo::"));
  const running = userSessions.filter((s) => s.status === "running");
  const trend = userSessions.map((s) => s.n_hyps).slice(0, 12).reverse();

  if (loading && !sessions) {
    return <Loader label="Loading dashboard" />;
  }

  return (
    <div className="animate-fade-up space-y-8">
      {/* Live sessions banner */}
      {running.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.06] px-4 py-3 text-sm text-blue-200">
          <span className="h-2 w-2 shrink-0 rounded-full bg-blue-400 animate-pulseDot" />
          {running.length} session{running.length > 1 ? "s" : ""} running — live updates streaming.
        </div>
      )}

      {/* Your sessions */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-fg">Your sessions</h2>
            {userSessions.length > 0 && trend.length > 1 && (
              <div className="flex items-center gap-1.5 text-[11px] text-faint">
                trend <Sparkline values={trend} width={64} height={20} />
              </div>
            )}
          </div>
          {userSessions.length > 0 && (
            <Link to="/new" className="btn-primary h-8 px-3 text-xs">+ New session</Link>
          )}
        </div>

        {userSessions.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {userSessions.map((s) => <SessionCard key={s.id} s={s} />)}
          </div>
        )}
      </section>

      {/* Demo examples — collapsible section */}
      {demoSessions.length > 0 && (
        <section>
          <button
            onClick={() => setShowDemo((v) => !v)}
            className="mb-4 flex w-full items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-muted">Example sessions</h2>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-faint">
                {demoSessions.length}
              </span>
            </div>
            <span className="text-[11px] text-faint hover:text-muted transition">
              {showDemo ? "Hide ↑" : "Show ↓"}
            </span>
          </button>
          {showDemo && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-fade-up">
              {demoSessions.map((s) => <SessionCard key={s.id} s={s} />)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
