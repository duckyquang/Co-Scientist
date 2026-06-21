import { marked } from "marked";
import type { ReactNode } from "react";
import {
  HYP_STATE_STYLE, STATUS_STYLE, STRATEGY_ICON, agentColor,
} from "../lib/format";

export function StatusBadge({ status }: { status: string }) {
  const live = status === "running";
  return (
    <span className={`chip ${STATUS_STYLE[status] || STATUS_STYLE.aborted}`}>
      {live && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulseDot" />}
      {status}
    </span>
  );
}

export function StateBadge({ state }: { state: string }) {
  return <span className={`chip ${HYP_STATE_STYLE[state] || HYP_STATE_STYLE.draft}`}>{state.replace("_", " ")}</span>;
}

export function StrategyTag({ strategy }: { strategy: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[11px] font-medium text-slate-300">
      <span>{STRATEGY_ICON[strategy] || "•"}</span>
      <span className="font-mono">{strategy}</span>
    </span>
  );
}

export function AgentTag({ agent }: { agent: string | null | undefined }) {
  const c = agentColor(agent);
  return (
    <span className={`chip ${c.bg} ${c.text}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.hex }} />
      {agent || "system"}
    </span>
  );
}

export function Stat({ label, value, sub, accent }: {
  label: string; value: ReactNode; sub?: ReactNode; accent?: string;
}) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className="stat-num mt-1" style={accent ? { color: accent } : undefined}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export function Progress({ value, max, color = "#6366f1" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
      <div className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}, #a855f7)` }} />
    </div>
  );
}

export function Markdown({ md }: { md: string }) {
  const html = marked.parse(md, { async: false }) as string;
  return <div className="prose-sci" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Loader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-16 text-slate-400">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500/30 border-t-brand-400" />
      {label}…
    </div>
  );
}

export function Empty({ icon = "🪐", title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 py-16 text-center">
      <div className="text-4xl">{icon}</div>
      <div className="text-base font-semibold text-slate-200">{title}</div>
      {hint && <div className="max-w-md text-sm text-slate-500">{hint}</div>}
    </div>
  );
}

export function Section({ title, action, children, className = "" }: {
  title: ReactNode; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-300">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
