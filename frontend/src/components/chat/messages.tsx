import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Telescope, Sparkles, Swords, GitBranch, FileText, User, MessageSquare,
  Loader2, Check, ChevronDown, ArrowRight,
} from "lucide-react";
import { EloRace } from "../charts";
import { OverviewPanel } from "../session/panels";
import { Markdown, StrategyTag } from "../ui";
import { eloColor } from "../../lib/format";
import type { ChatTurn } from "../../api";
import type { Feedback, Hypothesis, Match, ResearchPlan } from "../../types";

/* ── Message model — derived from the session snapshot ─────────
   The thread is a PURE FUNCTION of the current data, so it's identical whether
   a session is streaming live or reopened when done (replay = same derivation). */
export type ChatMsg =
  | { id: string; role: "user"; kind: "goal" | "feedback"; text: string }
  | { id: string; role: "assistant"; kind: "understanding"; plan: ResearchPlan }
  | { id: string; role: "assistant"; kind: "generating"; hyps: Hypothesis[]; reviewed: number; active: boolean }
  | { id: string; role: "assistant"; kind: "ranking"; top: Hypothesis[]; series: Record<string, { i: number; elo: number }[]>; matches: number; active: boolean }
  | { id: string; role: "assistant"; kind: "evolving"; offspring: Hypothesis[] }
  | { id: string; role: "assistant"; kind: "feedback"; text: string }
  | { id: string; role: "assistant"; kind: "proposal"; md: string }
  // Follow-up chat turns (routed: question answer / tweak-rerun / out-of-scope).
  | { id: string; role: "user"; kind: "chat"; text: string }
  | { id: string; role: "assistant"; kind: "answer"; md: string; newSessionId?: string | null; refs: Hypothesis[] };

export function deriveMessages(input: {
  goal: string;
  plan?: ResearchPlan;
  hyps: Hypothesis[];
  matches: Match[];
  eloHistory: Record<string, { i: number; elo: number }[]>;
  feedback: Feedback[];
  reviewed: number;
  overview: string | null;
  live: boolean;
  done: boolean;
  chat?: ChatTurn[];
}): ChatMsg[] {
  const { goal, plan, hyps, matches, eloHistory, feedback, reviewed, overview, live, done, chat } = input;
  const msgs: ChatMsg[] = [];

  msgs.push({ id: "goal", role: "user", kind: "goal", text: goal });

  if (plan?.objective) msgs.push({ id: "understanding", role: "assistant", kind: "understanding", plan });

  const initial = hyps.filter((h) => h.created_by !== "evolution");
  if (initial.length) {
    msgs.push({
      id: "generating", role: "assistant", kind: "generating",
      hyps: initial, reviewed, active: live && matches.length === 0,
    });
  }

  if (matches.length) {
    const ranked = [...hyps].filter((h) => h.elo != null).sort((a, b) => (b.elo ?? 0) - (a.elo ?? 0));
    msgs.push({
      id: "ranking", role: "assistant", kind: "ranking",
      top: ranked.slice(0, 6), series: eloHistory, matches: matches.length, active: live,
    });
  }

  const offspring = hyps.filter((h) => h.created_by === "evolution");
  if (offspring.length) msgs.push({ id: "evolving", role: "assistant", kind: "evolving", offspring });

  // Feedback endpoints return newest-first (correct for the Explore feed), but a
  // top-to-bottom chat thread must read oldest-first like the rest of the thread.
  const fbAsc = [...feedback].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
  for (const f of fbAsc) {
    msgs.push({
      id: `fb-${f.id}`,
      role: f.source === "human" ? "user" : "assistant",
      kind: "feedback", text: f.text,
    });
  }

  if (done && overview) msgs.push({ id: "proposal", role: "assistant", kind: "proposal", md: overview });

  // Follow-up chat turns sit at the end of the thread, oldest-first. Stable ids
  // (index-based over a stable-ordered history) keep them fixed across re-derivation.
  const byId = new Map(hyps.map((h) => [h.id, h]));
  (chat ?? []).forEach((t, i) => {
    if (t.role === "user") {
      msgs.push({ id: `chat-${i}`, role: "user", kind: "chat", text: t.text });
    } else {
      const refs = Array.from(new Set(t.text.match(/hyp_[a-z0-9_]+/gi) || []))
        .map((id) => byId.get(id)).filter((h): h is Hypothesis => !!h);
      msgs.push({
        id: `chat-${i}`, role: "assistant", kind: "answer",
        md: t.text, newSessionId: t.new_session_id, refs,
      });
    }
  });

  return msgs;
}

/* ── Renderers ─────────────────────────────────────────────── */
const PHASE_META: Record<string, { icon: any; label: string }> = {
  understanding: { icon: Telescope, label: "Understanding your goal" },
  generating: { icon: Sparkles, label: "Generating hypotheses" },
  ranking: { icon: Swords, label: "Running the tournament" },
  evolving: { icon: GitBranch, label: "Evolving the best ideas" },
  proposal: { icon: FileText, label: "Research proposal" },
};

function PhaseHeader({ kind, active }: { kind: string; active?: boolean }) {
  const m = PHASE_META[kind];
  const Icon = m.icon;
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand-500/12 text-brand-600 dark:text-brand-400">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="text-[12.5px] font-semibold text-fg">{m.label}</span>
      {active
        ? <Loader2 className="h-3.5 w-3.5 animate-spin text-faint" />
        : <Check className="h-3.5 w-3.5 text-accent-500" />}
    </div>
  );
}

function Assistant({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 animate-fade-up">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-600 shadow-glow">
        <Sparkles className="h-3.5 w-3.5 text-white" />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end gap-3 animate-fade-up">
      <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-brand-600 px-4 py-2.5 text-[14px] leading-relaxed text-white">
        {text}
      </div>
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
        <User className="h-3.5 w-3.5" />
      </span>
    </div>
  );
}

function HypRow({ h, rank, onSelect }: { h: Hypothesis; rank?: number; onSelect: (id: string) => void }) {
  return (
    <button onClick={() => onSelect(h.id)}
      className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-left transition hover:border-brand-500/40">
      {rank != null && (
        <span className="w-5 shrink-0 text-center text-[12px] font-bold text-faint">{rank}</span>
      )}
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{h.title}</span>
      <StrategyTag strategy={h.strategy} />
      {h.elo != null && (
        <span className={`shrink-0 text-[13px] font-bold ${eloColor(h.elo)}`}>{Math.round(h.elo)}</span>
      )}
    </button>
  );
}

export function ChatMessage({ msg, onSelect }: { msg: ChatMsg; onSelect: (id: string) => void }) {
  if (msg.role === "user") return <UserBubble text={msg.text} />;

  if (msg.kind === "understanding") {
    const p = msg.plan;
    return (
      <Assistant>
        <PhaseHeader kind="understanding" />
        <div className="rounded-xl border border-line bg-surface p-4 text-[13px]">
          <p className="text-muted">{p.objective}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(p.preferences || []).map((x) => (
              <span key={x} className="chip bg-brand-500/10 text-brand-600 dark:text-brand-300">{x}</span>
            ))}
            {(p.constraints || []).map((x) => (
              <span key={x} className="chip bg-surface-2 text-faint">{x}</span>
            ))}
          </div>
        </div>
      </Assistant>
    );
  }

  if (msg.kind === "generating") {
    return (
      <Assistant>
        <PhaseHeader kind="generating" active={msg.active} />
        <p className="mb-2.5 text-[13px] text-muted">
          Generated <span className="font-semibold text-fg">{msg.hyps.length}</span> initial{" "}
          hypothes{msg.hyps.length === 1 ? "is" : "es"}
          {msg.reviewed > 0 && <> · reviewed <span className="font-semibold text-fg">{msg.reviewed}</span></>}.
        </p>
        <div className="space-y-1.5">
          {msg.hyps.map((h) => <HypRow key={h.id} h={h} onSelect={onSelect} />)}
        </div>
      </Assistant>
    );
  }

  if (msg.kind === "ranking") {
    return (
      <Assistant>
        <PhaseHeader kind="ranking" active={msg.active} />
        <p className="mb-2.5 text-[13px] text-muted">
          Ran <span className="font-semibold text-fg">{msg.matches}</span> head-to-head matches.
          Current standings:
        </p>
        <div className="space-y-1.5">
          {msg.top.map((h, i) => <HypRow key={h.id} h={h} rank={i + 1} onSelect={onSelect} />)}
        </div>
        {Object.keys(msg.series).length > 0 && (
          <div className="mt-3 rounded-xl border border-line bg-surface-2/40 p-4">
            <div className="label mb-2">Elo over matches</div>
            <EloRace series={msg.series} onSelect={onSelect} height={180} />
          </div>
        )}
      </Assistant>
    );
  }

  if (msg.kind === "evolving") {
    return (
      <Assistant>
        <PhaseHeader kind="evolving" />
        <p className="mb-2.5 text-[13px] text-muted">
          Bred <span className="font-semibold text-fg">{msg.offspring.length}</span> offspring by
          combining and mutating the top-ranked parents.
        </p>
        <div className="space-y-1.5">
          {msg.offspring.map((h) => <HypRow key={h.id} h={h} onSelect={onSelect} />)}
        </div>
      </Assistant>
    );
  }

  if (msg.kind === "feedback") {
    return (
      <Assistant>
        <div className="flex items-start gap-2 rounded-xl border border-line bg-surface-2/40 p-3 text-[13px] text-muted">
          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
          <span>{msg.text}</span>
        </div>
      </Assistant>
    );
  }

  // Follow-up chat answer (question / tweak / out-of-scope).
  if (msg.kind === "answer") {
    return (
      <Assistant>
        <div className="rounded-xl border border-line bg-surface p-4 text-[13px]">
          <Markdown md={msg.md} />
          {msg.refs.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {msg.refs.map((h) => <HypRow key={h.id} h={h} onSelect={onSelect} />)}
            </div>
          )}
          {msg.newSessionId && (
            <Link to={`/s/${msg.newSessionId}`}
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-600 hover:underline dark:text-brand-400">
              Open the new run <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </Assistant>
    );
  }

  // proposal
  return (
    <Assistant>
      <PhaseHeader kind="proposal" />
      <ProposalMessage md={msg.md} />
    </Assistant>
  );
}

/** The final proposal — collapsed to a preview by default with a full expand,
 *  reusing OverviewPanel (which already renders the rich markdown + Copy/PDF). */
function ProposalMessage({ md }: { md: string }) {
  const [open, setOpen] = useState(false);
  if (open) return <OverviewPanel md={md} />;
  return (
    <button onClick={() => setOpen(true)}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-4 text-left transition hover:border-brand-500/40">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-500/12 text-brand-600 dark:text-brand-400">
        <FileText className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-fg">Your research proposal is ready</div>
        <div className="text-[12px] text-faint">Charts, scorecard, lineage, and next-step experiments · copy or download as PDF</div>
      </div>
      <ChevronDown className="h-4 w-4 shrink-0 text-faint" />
    </button>
  );
}
