import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Telescope, Sparkles, Swords, GitBranch, FileText, User, MessageSquare,
  Loader2, Check, ChevronDown, ArrowRight, RefreshCw, FlaskConical,
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
  | { id: string; role: "assistant"; kind: "evolving"; round: number; offspring: Hypothesis[] }
  | { id: string; role: "assistant"; kind: "feedback"; text: string }
  // Self-critique ("requestioning") round — optional Thinking section + narrative.
  | { id: string; role: "assistant"; kind: "critique"; round: number; thinking: string | null; body: string }
  // Stress-test report for one top hypothesis; `first` carries the stage header.
  | { id: string; role: "assistant"; kind: "stresstest"; hypId: string; hypTitle: string; thinking: string | null; body: string; first: boolean; active: boolean }
  // Final ranking after stress tests + fixes.
  | { id: string; role: "assistant"; kind: "stressranking"; md: string; refs: Hypothesis[] }
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

  // Evolution offspring, one message per round. Stress-fix children are also
  // created_by "evolution" but belong to the stress-testing stage, not here.
  const offspring = hyps
    .filter((h) => h.created_by === "evolution" && h.strategy !== "feedback_driven")
    .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
  clusterRounds(offspring).forEach((round, i) => {
    msgs.push({ id: `evolving-${i + 1}`, role: "assistant", kind: "evolving", round: i + 1, offspring: round });
  });

  // Feedback endpoints return newest-first (correct for the Explore feed), but a
  // top-to-bottom chat thread must read oldest-first like the rest of the thread.
  const fbAsc = [...feedback].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
  const byId = new Map(hyps.map((h) => [h.id, h]));
  const hasStressRanking = feedback.some((f) => f.kind === "stress_ranking");
  let critiqueRound = 0;
  let firstStress = true;
  for (const f of fbAsc) {
    if (f.kind === "self_critique") {
      const { thinking, body } = parseSections(f.text, "Self-critique");
      msgs.push({
        id: `fb-${f.id}`, role: "assistant", kind: "critique",
        round: ++critiqueRound, thinking, body,
      });
      continue;
    }
    if (f.kind === "stress_test") {
      const { thinking, body } = parseSections(f.text, "Stress test");
      msgs.push({
        id: `fb-${f.id}`, role: "assistant", kind: "stresstest",
        hypId: f.target_id ?? "",
        hypTitle: (f.target_id && byId.get(f.target_id)?.title) || f.target_id || "hypothesis",
        thinking, body,
        first: firstStress,
        active: live && !hasStressRanking && !done,
      });
      firstStress = false;
      continue;
    }
    if (f.kind === "stress_ranking") {
      const refs = Array.from(new Set(f.text.match(/hyp_[a-z0-9_]+/gi) || []))
        .map((id) => byId.get(id)).filter((h): h is Hypothesis => !!h);
      msgs.push({ id: `fb-${f.id}`, role: "assistant", kind: "stressranking", md: f.text, refs });
      continue;
    }
    msgs.push({
      id: `fb-${f.id}`,
      role: f.source === "human" ? "user" : "assistant",
      kind: "feedback", text: f.text,
    });
  }

  if (done && overview) msgs.push({ id: "proposal", role: "assistant", kind: "proposal", md: overview });

  // Follow-up chat turns sit at the end of the thread, oldest-first. Stable ids
  // (index-based over a stable-ordered history) keep them fixed across re-derivation.
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

/** Cluster evolution offspring (pre-sorted by created_at) into rounds: a new
 *  round starts at any timestamp gap > max(2× the smallest gap, 1s). Within a
 *  round offspring land in quick succession; between rounds a ranking phase
 *  runs, so the gap is reliably larger — for both sim timelines and real runs.
 *  A pure function of the timestamps, so live re-derivations stay stable. */
function clusterRounds(offspring: Hypothesis[]): Hypothesis[][] {
  if (!offspring.length) return [];
  const ts = offspring.map((h) => +new Date(h.created_at));
  const gaps = ts.slice(1).map((t, i) => t - ts[i]);
  const threshold = Math.max(2 * Math.min(...gaps), 1000);
  const rounds: Hypothesis[][] = [[offspring[0]]];
  gaps.forEach((g, i) => {
    if (g > threshold) rounds.push([]);
    rounds[rounds.length - 1].push(offspring[i + 1]);
  });
  return rounds;
}

/** Split a feedback text into its `## Thinking` (optional) and `## <section>`
 *  sections. Unparseable text → whole thing as the body. */
function parseSections(text: string, section: string): { thinking: string | null; body: string } {
  const both = text.match(new RegExp(`^##\\s*Thinking\\s*\\n+([\\s\\S]*?)\\n+##\\s*${section}\\s*\\n+([\\s\\S]*)$`, "i"));
  if (both) return { thinking: both[1].trim(), body: both[2].trim() };
  const solo = text.match(new RegExp(`^##\\s*${section}\\s*\\n+([\\s\\S]*)$`, "i"));
  if (solo) return { thinking: null, body: solo[1].trim() };
  return { thinking: null, body: text };
}

/* ── Renderers ─────────────────────────────────────────────── */
const PHASE_META: Record<string, { icon: any; label: string }> = {
  understanding: { icon: Telescope, label: "Understanding your goal" },
  generating: { icon: Sparkles, label: "Generating hypotheses" },
  ranking: { icon: Swords, label: "Running the tournament" },
  evolving: { icon: GitBranch, label: "Evolving the best ideas" },
  testing: { icon: FlaskConical, label: "Stress-testing the top ideas" },
  proposal: { icon: FileText, label: "Research proposal" },
};

function PhaseHeader({ kind, active, label }: { kind: string; active?: boolean; label?: string }) {
  const m = PHASE_META[kind];
  const Icon = m.icon;
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <span className="grid h-6 w-6 place-items-center border border-rule bg-blue-soft text-blue">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink">{label ?? m.label}</span>
      {active
        ? <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-soft" />
        : <Check className="h-3.5 w-3.5 text-green" />}
    </div>
  );
}

function Assistant({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3 animate-fade-up">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center border border-rule bg-card text-blue">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end gap-3 animate-fade-up">
      <div className="max-w-[80%] border border-blue bg-blue-soft px-4 py-2.5 text-[14px] leading-relaxed text-ink">
        {text}
      </div>
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center border border-rule bg-card text-ink-soft">
        <User className="h-3.5 w-3.5" />
      </span>
    </div>
  );
}

function HypRow({ h, rank, onSelect }: { h: Hypothesis; rank?: number; onSelect: (id: string) => void }) {
  return (
    <button onClick={() => onSelect(h.id)}
      className="flex w-full items-center gap-3 border border-rule bg-card px-3 py-2 text-left transition-colors hover:border-ink-soft">
      {rank != null && (
        <span className={`num w-5 shrink-0 text-center text-[12px] font-bold ${rank <= 3 ? "text-accent" : "text-ink-soft"}`}>{rank}</span>
      )}
      <span className="min-w-0 flex-1 truncate font-serif text-[13px] font-medium text-ink">{h.title}</span>
      <StrategyTag strategy={h.strategy} />
      {h.elo != null && (
        <span className={`num shrink-0 text-[13px] font-bold ${eloColor(h.elo)}`}>{Math.round(h.elo)}</span>
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
        <div className="border border-rule bg-card p-4 text-[13px]">
          <p className="text-ink-soft">{p.objective}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(p.preferences || []).map((x) => (
              <span key={x} className="chip chip-blue">{x}</span>
            ))}
            {(p.constraints || []).map((x) => (
              <span key={x} className="chip chip-mute">{x}</span>
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
        <p className="mb-2.5 text-[13px] text-ink-soft">
          Generated <span className="num font-semibold text-ink">{msg.hyps.length}</span> initial{" "}
          hypothes{msg.hyps.length === 1 ? "is" : "es"}
          {msg.reviewed > 0 && <> · reviewed <span className="num font-semibold text-ink">{msg.reviewed}</span></>}.
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
        <p className="mb-2.5 text-[13px] text-ink-soft">
          Ran <span className="num font-semibold text-ink">{msg.matches}</span> head-to-head matches.
          Current standings:
        </p>
        <div className="space-y-1.5">
          {msg.top.map((h, i) => <HypRow key={h.id} h={h} rank={i + 1} onSelect={onSelect} />)}
        </div>
        {Object.keys(msg.series).length > 0 && (
          <div className="mt-3 border border-rule bg-card p-4">
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
        <PhaseHeader kind="evolving" label={`Evolution · Round ${msg.round}`} />
        <p className="mb-2.5 text-[13px] text-ink-soft">
          Bred <span className="num font-semibold text-ink">{msg.offspring.length}</span> offspring by
          combining and mutating the top-ranked parents{msg.round > 1 ? " after re-ranking" : ""}.
        </p>
        <div className="space-y-1.5">
          {msg.offspring.map((h) => <HypRow key={h.id} h={h} onSelect={onSelect} />)}
        </div>
      </Assistant>
    );
  }

  // Self-critique round — the agent requestioning its own output.
  if (msg.kind === "critique") {
    return (
      <Assistant>
        <div className="mb-2.5 flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center border border-rule bg-blue-soft text-blue">
            <RefreshCw className="h-3.5 w-3.5" />
          </span>
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink">
            Self-critique · Round {msg.round}
          </span>
        </div>
        <div className="border border-rule bg-card p-4 text-[13px]">
          {msg.thinking && (
            <details className="mb-3">
              <summary className="cursor-pointer select-none font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-soft transition-colors hover:text-ink">
                Thinking process
              </summary>
              <div className="mt-2 whitespace-pre-wrap border-l-2 border-rule pl-3 font-mono text-[12px] leading-relaxed text-ink-soft">
                {msg.thinking}
              </div>
            </details>
          )}
          <Markdown md={msg.body} />
        </div>
      </Assistant>
    );
  }

  // Stress-test report for one of the top hypotheses.
  if (msg.kind === "stresstest") {
    return (
      <Assistant>
        {msg.first && <PhaseHeader kind="testing" active={msg.active} />}
        <div className="mb-2.5 flex items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center border border-rule bg-blue-soft text-blue">
            <FlaskConical className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0 truncate font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink">
            Stress test · {msg.hypTitle}
          </span>
        </div>
        <div className="border border-rule bg-card p-4 text-[13px]">
          {msg.thinking && (
            <details className="mb-3">
              <summary className="cursor-pointer select-none font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-soft transition-colors hover:text-ink">
                Thinking process
              </summary>
              <div className="mt-2 whitespace-pre-wrap border-l-2 border-rule pl-3 font-mono text-[12px] leading-relaxed text-ink-soft">
                {msg.thinking}
              </div>
            </details>
          )}
          <Markdown md={msg.body} />
        </div>
      </Assistant>
    );
  }

  // Final ranking of the top ideas after stress tests + fixes.
  if (msg.kind === "stressranking") {
    return (
      <Assistant>
        <div className="mb-2.5 flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center border border-rule bg-blue-soft text-blue">
            <Check className="h-3.5 w-3.5" />
          </span>
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink">
            Final ranking after testing
          </span>
        </div>
        <div className="border border-rule bg-card p-4 text-[13px]">
          <Markdown md={msg.md} />
          {msg.refs.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {msg.refs.map((h) => <HypRow key={h.id} h={h} onSelect={onSelect} />)}
            </div>
          )}
        </div>
      </Assistant>
    );
  }

  if (msg.kind === "feedback") {
    return (
      <Assistant>
        <div className="flex items-start gap-2 border border-rule bg-card p-3 text-[13px] text-ink-soft">
          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-soft" />
          <span>{msg.text}</span>
        </div>
      </Assistant>
    );
  }

  // Follow-up chat answer (question / tweak / out-of-scope).
  if (msg.kind === "answer") {
    return (
      <Assistant>
        <div className="card p-4 text-[13px]">
          <Markdown md={msg.md} />
          {msg.refs.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {msg.refs.map((h) => <HypRow key={h.id} h={h} onSelect={onSelect} />)}
            </div>
          )}
          {msg.newSessionId && (
            <Link to={`/s/${msg.newSessionId}`}
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-blue hover:underline">
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
      className="flex w-full items-center gap-3 border border-rule bg-card p-4 text-left transition-colors hover:border-blue">
      <span className="grid h-10 w-10 shrink-0 place-items-center border border-rule bg-blue-soft text-blue">
        <FileText className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-serif text-[14px] font-semibold text-ink">Your research proposal is ready</div>
        <div className="text-[12px] text-ink-soft">Charts, scorecard, lineage, and next-step experiments · copy or download as PDF</div>
      </div>
      <ChevronDown className="h-4 w-4 shrink-0 text-ink-soft" />
    </button>
  );
}
