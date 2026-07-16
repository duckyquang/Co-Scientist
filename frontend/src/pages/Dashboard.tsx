import { useState } from "react";
import { Link } from "react-router-dom";
import { Microscope } from "lucide-react";
import { api } from "../api";
import { Sparkline } from "../components/charts";
import { Loader, Progress, StatusBadge } from "../components/ui";
import { eloColor, fmtCompact, timeAgo } from "../lib/format";
import { usePoll, useReveal } from "../lib/hooks";
import type { SessionRow } from "../types";

const EXAMPLE_PROMPTS = [
  "Identify novel drug-repurposing candidates for acute myeloid leukemia",
  "Propose mechanisms linking the gut microbiome to neuroinflammation",
  "Generate hypotheses for overcoming antibody resistance in HER2+ breast cancer",
  "Find testable strategies to extend the lifespan of human cardiac organoids",
];

function SessionCard({ s, runs = 1 }: { s: SessionRow; runs?: number }) {
  const tokCap = s.budget_tokens || 0;
  const pct = tokCap > 0 ? (s.budget_used_tokens / tokCap) * 100 : 0;
  const ref = useReveal<HTMLAnchorElement>();
  return (
    <Link ref={ref} to={`/s/${s.id}`} className="card card-hover reveal block p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={s.status} />
          {runs > 1 && <span className="chip chip-mute num">{runs} runs</span>}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">{timeAgo(s.updated_at)}</span>
      </div>
      <h3 className="mt-3 line-clamp-2 font-serif text-[16px] font-semibold leading-snug text-ink">
        {s.research_goal}
      </h3>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="num text-lg font-bold text-ink">{s.n_hyps}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">hypotheses</div>
        </div>
        <div>
          <div className={`num text-lg font-bold ${eloColor(s.top_elo)}`}>
            {s.top_elo ? Math.round(s.top_elo) : "—"}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">top elo</div>
        </div>
        <div>
          <div className="num text-lg font-bold text-ink">{s.n_matches}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">matches</div>
        </div>
      </div>
      <div className="mt-4">
        <div className="num mb-1 flex justify-between text-[11px] text-ink-soft">
          <span>{fmtCompact(s.budget_used_tokens)} / {fmtCompact(tokCap)} tokens</span>
          <span>{pct.toFixed(0)}%</span>
        </div>
        <Progress value={s.budget_used_tokens} max={tokCap} />
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="card flex flex-col items-center gap-6 px-8 py-14 text-center">
      <div className="grid h-16 w-16 place-items-center border border-rule bg-blue-soft">
        <Microscope className="h-8 w-8 text-blue" />
      </div>
      <div>
        <h2 className="font-serif text-xl font-semibold text-ink">Start your first research session</h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-soft">
          Describe a scientific question and six AI agents will generate, debate, and
          Elo-rank novel hypotheses — live.
        </p>
      </div>
      <Link to="/chat" className="btn-primary px-6 py-2.5">
        Launch a session →
      </Link>
      <div className="w-full border-t border-rule" />
      <div className="w-full max-w-lg text-left">
        <div className="label mb-3">
          Try one of these prompts
        </div>
        <div className="space-y-2">
          {EXAMPLE_PROMPTS.map((p) => (
            <Link
              key={p}
              to={`/chat?goal=${encodeURIComponent(p)}`}
              className="block border border-rule bg-card px-4 py-2.5 text-sm text-ink-soft transition-colors hover:border-blue hover:text-ink"
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

  // One card per rerun chain (chat "tweak" spawns share an origin root):
  // show only the NEWEST run; older runs stay reachable via the parent
  // thread's "Open the new run →" links.
  const chains = new Map<string, { s: SessionRow; runs: number }>();
  for (const s of userSessions) {
    const root = s.origin_session_id ?? s.id;
    const g = chains.get(root);
    if (!g) chains.set(root, { s, runs: 1 });
    else {
      g.runs += 1;
      if (+new Date(s.updated_at) > +new Date(g.s.updated_at)) g.s = s;
    }
  }
  const chainCards = [...chains.values()];

  if (loading && !sessions) {
    return <Loader label="Loading dashboard" />;
  }

  return (
    <div className="animate-fade-up space-y-8">
      {/* Live sessions banner */}
      {running.length > 0 && (
        <div className="flex items-center gap-3 border border-blue bg-blue-soft px-4 py-3 text-sm text-ink">
          <span className="h-2 w-2 shrink-0 rounded-full bg-blue animate-pulseDot" />
          {running.length} session{running.length > 1 ? "s" : ""} running — live updates streaming.
        </div>
      )}

      {/* Your sessions */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="font-serif text-base font-semibold text-ink">
              <span className="sec-no">§1</span>Your sessions
            </h2>
            {userSessions.length > 0 && trend.length > 1 && (
              <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">
                trend <Sparkline values={trend} width={64} height={20} />
              </div>
            )}
          </div>
          {userSessions.length > 0 && (
            <Link to="/chat" className="btn-primary h-8 px-3">+ New session</Link>
          )}
        </div>

        {userSessions.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {chainCards.map(({ s, runs }) => <SessionCard key={s.id} s={s} runs={runs} />)}
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
              <h2 className="font-serif text-base font-semibold text-ink">
                <span className="sec-no">§2</span>Example sessions
              </h2>
              <span className="chip chip-mute num">{demoSessions.length}</span>
            </div>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-soft transition-colors hover:text-ink">
              {showDemo ? "Hide ↑" : "Show ↓"}
            </span>
          </button>
          {showDemo && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {demoSessions.map((s) => <SessionCard key={s.id} s={s} />)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
