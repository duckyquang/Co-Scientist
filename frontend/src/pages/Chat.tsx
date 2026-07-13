import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import {
  Layers, Pause, Play, Square, Loader2, Sparkles,
} from "lucide-react";
import { api, type ChatTurn } from "../api";
import { Composer } from "../components/chat/Composer";
import { ChatMessage, deriveMessages } from "../components/chat/messages";
import { ExploreDrawer } from "../components/chat/ExploreDrawer";
import { HypothesisDrawer } from "../components/session/HypothesisDrawer";
import { Compare } from "../components/session/Compare";
import { Loader, StatusBadge } from "../components/ui";
import { fmtCompact, fmtDuration } from "../lib/format";
import { useSessionStream, usePoll, useStickToBottom } from "../lib/hooks";
import { isSimulatedMode } from "../lib/live";
import { RUN_PRESETS, type RunPreset } from "../types";
import type {
  ClusterPoint, CostByAgent, Feedback, Hypothesis, LineageNode, Match, SessionDetail,
} from "../types";

const EXAMPLES = [
  "Identify novel drug-repurposing candidates for acute myeloid leukemia",
  "Propose mechanisms linking the gut microbiome to neuroinflammation",
  "Find testable strategies to extend the lifespan of human cardiac organoids",
  "Generate hypotheses for overcoming antibody resistance in HER2+ breast cancer",
];

/* ── Router entry: landing (no id) or a session thread ─────── */
export default function Chat() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="flex h-full flex-col px-4 md:px-6">
      {id ? <Thread key={id} id={id} /> : (
        <div className="flex-1 overflow-y-auto">
          <div className="flex min-h-full flex-col"><Landing /></div>
        </div>
      )}
    </div>
  );
}

/* ── Landing — centered composer, greeting, effort, suggestions ── */
function Landing() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [goal, setGoal] = useState(() => params.get("goal") ?? "");
  const [presetId, setPresetId] = useState<RunPreset["id"]>("standard");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preset = RUN_PRESETS.find((p) => p.id === presetId)!;
  const simulated = isSimulatedMode();

  async function submit() {
    if (goal.trim().length < 12) { setError("Describe a research goal — at least a sentence."); return; }
    setSubmitting(true); setError(null);
    try {
      const { session_id } = await api.create({
        goal: goal.trim(), budget_tokens: preset.budget_tokens,
        wall_clock_seconds: preset.wall_clock_seconds, n_initial: preset.n_initial, provider: "groq",
      });
      nav(`/s/${session_id}`);
    } catch (e: any) { setError(e.message || "Failed to start session"); setSubmitting(false); }
  }

  if (submitting) return <div className="flex flex-1 items-center justify-center"><Loader label="Spinning up your research session" /></div>;

  const effort = (
    <div className="flex items-center gap-1">
      <span className="mr-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-soft">Effort</span>
      {RUN_PRESETS.map((p) => (
        <button key={p.id} onClick={() => setPresetId(p.id)}
          title={`≤ ${fmtCompact(p.budget_tokens)} tokens · ≤ ${fmtDuration(p.wall_clock_seconds)}`}
          className={`border px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] transition-colors ${
            p.id === presetId ? "border-blue bg-blue-soft text-blue" : "border-transparent text-ink-soft hover:text-ink"
          }`}>
          {p.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center py-10">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 w-fit border-b-2 border-accent pb-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-soft">
          Co-Scientist
        </div>
        <h1 className="font-serif font-semibold leading-[1.15] text-ink" style={{ fontSize: "clamp(1.5rem,3vw,2.1rem)" }}>
          What do you want to <em className="italic text-accent">discover</em>?
        </h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Describe a scientific question. Six AI agents generate hypotheses and rank them through a live tournament.
        </p>
      </div>

      <Composer
        value={goal} onChange={setGoal} onSend={submit} autoFocus
        placeholder="e.g. Identify novel drug-repurposing candidates for acute myeloid leukemia…"
        accessory={effort}
      />

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((ex) => (
          <button key={ex} onClick={() => setGoal(ex)}
            className="border border-rule bg-card px-3 py-1.5 text-[12px] text-ink-soft transition-colors hover:border-blue hover:text-ink">
            {ex.length > 46 ? ex.slice(0, 46) + "…" : ex}
          </button>
        ))}
      </div>

      <p className="mt-6 text-center font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-soft">
        {simulated ? "Free · runs in your browser · no key, no account" : "Free · no API key required"}
      </p>
      {error && <p className="mt-3 text-center text-sm text-accent">{error}</p>}
    </div>
  );
}

/* ── Thread — the live conversation ────────────────────────── */
interface Bundle {
  detail: SessionDetail;
  hyps: Hypothesis[];
  matches: Match[];
  cost: { by_agent: CostByAgent[]; summary: any };
  feedback: Feedback[];
  lineage: { nodes: LineageNode[]; edges: { source: string; target: string }[] };
  clusters: ClusterPoint[];
  eloHistory: Record<string, { i: number; elo: number }[]>;
  chat: ChatTurn[];
}

function Thread({ id }: { id: string }) {
  const [steer, setSteer] = useState("");
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [compareBase, setCompareBase] = useState<string | null>(null);
  const [comparePair, setComparePair] = useState<[string, string] | null>(null);
  const [explore, setExplore] = useState(false);
  const [overview, setOverview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { events, tick, connected } = useSessionStream(id);

  const fetchAll = useCallback(async (): Promise<Bundle> => {
    const [detail, hyps, matches, cost, feedback, lineage, clusters, eloHistory, chat] = await Promise.all([
      api.session(id), api.hypotheses(id), api.matches(id), api.cost(id),
      api.feedback(id), api.lineage(id), api.clusters(id), api.eloHistory(id),
      api.chatHistory(id).catch(() => [] as ChatTurn[]),
    ]);
    return { detail, hyps, matches, cost, feedback, lineage, clusters, eloHistory, chat };
  }, [id]);

  const { data, error, loading, refresh } = usePoll<Bundle>(fetchAll, [id], null);
  // Sim sessions drive `tick` (~1.1s); refresh the bundle on each.
  useEffect(() => { if (tick) refresh(); /* eslint-disable-next-line */ }, [tick]);

  const status = data?.detail.session.status;
  const live = status === "running";

  // The real backend's SSE emits named events, not a periodic tick, so poll the
  // bundle on an interval while live — this is what animates the thread on real
  // runs (harmless duplicate refresh for the tick-driven sim).
  useEffect(() => {
    if (!live) return;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [live, refresh]);
  const done = status === "done";
  const session = data?.detail.session;
  const metrics = data?.detail.metrics;

  useEffect(() => {
    if (done || session?.final_overview) api.overview(id).then(setOverview).catch(() => {});
  }, [id, done, session?.final_overview]);

  const messages = useMemo(() => {
    if (!data || !session || !metrics) return [];
    return deriveMessages({
      goal: session.research_goal, plan: session.research_plan,
      hyps: data.hyps, matches: data.matches, eloHistory: data.eloHistory,
      feedback: data.feedback, reviewed: metrics.n_reviewed,
      overview, live, done, chat: data.chat,
    });
  }, [data, session, metrics, overview, live, done]);

  // Re-pin to bottom as content grows — including inside a single message (the
  // generating list and match count grow without adding messages).
  const growth = messages.length + (data?.hyps.length ?? 0) + (data?.matches.length ?? 0) + (live ? 1 : 0);
  const { scrollRef, onScroll } = useStickToBottom(growth);

  function onSelect(hid: string) {
    if (compareBase && compareBase !== hid) {
      setComparePair([compareBase, hid]); setCompareBase(null); setSelected(null); return;
    }
    setSelected(hid);
  }

  // Follow-ups are routed: question → grounded answer, tweak → new run, else
  // the fixed out-of-scope reply. Both turns are persisted and re-derived into
  // the thread on refresh. (Steering a running session stays in Explore.)
  async function sendSteer() {
    if (!steer.trim()) return;
    setSending(true);
    try { await api.chat(id, steer.trim()); setSteer(""); await refresh(); }
    finally { setSending(false); }
  }

  async function control(action: "pause" | "resume" | "abort") {
    if (action === "abort" && !window.confirm("Abort this session? Running agents will stop.")) return;
    setBusy(true);
    try { await api.control(id, action); await refresh(); } finally { setBusy(false); }
  }

  if (loading && !data) return <div className="flex flex-1 items-center justify-center"><Loader label="Loading session" /></div>;
  if ((error && !data) || !data || !session || !metrics) {
    return (
      <div className="mx-auto max-w-md flex-1 py-16 text-center">
        <h2 className="font-serif text-lg font-semibold text-ink">Session not found</h2>
        <Link to="/" className="btn-ghost mt-5 inline-flex">← New session</Link>
      </div>
    );
  }

  const tokenUsed = (metrics.input_tokens || 0) + (metrics.output_tokens || 0);
  const startMs = new Date(session.created_at).getTime();
  const endMs = live ? Date.now() : new Date(session.updated_at).getTime();
  const elapsed = Math.max(0, (endMs - startMs) / 1000);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Thread header — non-scrolling */}
      <div className="flex items-center gap-3 border-b border-rule pb-3 no-print">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusBadge status={session.status} />
            <span className={`inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.08em] ${connected ? "text-blue" : "text-ink-soft"}`}>
              {live && <span className="h-1.5 w-1.5 rounded-full bg-blue animate-pulseDot" />}
              {connected ? "live" : "idle"}
            </span>
            <span className="num hidden text-[11px] text-ink-soft sm:inline">
              · {fmtCompact(tokenUsed)}/{fmtCompact(session.budget_tokens)} tokens · {fmtDuration(elapsed)}
            </span>
          </div>
          <h1 className="mt-1 truncate font-serif text-[16px] font-semibold text-ink">{session.research_goal}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {live && <button disabled={busy} onClick={() => control("pause")} className="btn-ghost h-8 px-2.5"><Pause className="h-3.5 w-3.5" /></button>}
          {status === "paused" && <button disabled={busy} onClick={() => control("resume")} className="btn-primary h-8 px-2.5"><Play className="h-3.5 w-3.5" /></button>}
          {(live || status === "paused") && <button disabled={busy} onClick={() => control("abort")} className="btn-danger h-8 px-2.5"><Square className="h-3 w-3" /></button>}
          <button onClick={() => setExplore(true)} className="btn-ghost h-8">
            <Layers className="h-3.5 w-3.5" /> Explore
          </button>
        </div>
      </div>

      {/* Thread — scrolling */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-1">
          {messages.map((m) => <ChatMessage key={m.id} msg={m} onSelect={onSelect} />)}
          {live && (
            <div className="flex items-center gap-2 pl-10 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-soft">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="inline-flex items-center gap-1"><Sparkles className="h-3 w-3" /> Co-Scientist is working…</span>
            </div>
          )}
        </div>
      </div>

      {/* Composer — docked */}
      <div className="border-t border-rule pt-3 no-print">
        <div className="mx-auto max-w-3xl">
          <Composer
            value={steer} onChange={setSteer} onSend={sendSteer} sending={sending}
            placeholder={live ? "Steer the agents — e.g. focus on metabolic pathways…"
              : done ? "Ask a follow-up or steer a refinement…"
              : "Add a note for the agents…"}
          />
        </div>
      </div>

      {explore && (
        <ExploreDrawer
          sessionId={id} hyps={data.hyps} matches={data.matches} eloHistory={data.eloHistory}
          lineage={data.lineage} clusters={data.clusters} cost={data.cost} feedback={data.feedback}
          events={events} live={live} onSelect={(hid) => { setExplore(false); onSelect(hid); }}
          onSent={refresh} onClose={() => setExplore(false)}
        />
      )}
      {selected && (
        <HypothesisDrawer sessionId={id} hid={selected}
          onClose={() => setSelected(null)} onChanged={refresh}
          onCompare={(hid) => { setSelected(null); setCompareBase(hid); }} />
      )}
      {comparePair && (
        <Compare sessionId={id} aId={comparePair[0]} bId={comparePair[1]} onClose={() => setComparePair(null)} />
      )}
    </div>
  );
}
