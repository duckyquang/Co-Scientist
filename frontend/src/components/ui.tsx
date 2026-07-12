import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Mermaid } from "./report/Mermaid";
import { ReportChart } from "./report/ReportChart";
import { Info, Telescope, type LucideIcon } from "lucide-react";
import {
  HYP_STATE_STYLE, STATUS_STYLE, agentColor, strategyIcon,
} from "../lib/format";

export function StatusBadge({ status }: { status: string }) {
  const live = status === "running";
  return (
    <span className={`chip ${STATUS_STYLE[status] || STATUS_STYLE.aborted}`}>
      {live && <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulseDot" />}
      {status}
    </span>
  );
}

export function StateBadge({ state }: { state: string }) {
  return <span className={`chip ${HYP_STATE_STYLE[state] || HYP_STATE_STYLE.draft}`}>{state.replace("_", " ")}</span>;
}

export function StrategyTag({ strategy }: { strategy: string }) {
  const Icon = strategyIcon(strategy);
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-muted">
      <Icon className="h-3 w-3" />
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
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Progress({ value, max, color = "#3b82f6" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}, #34d399)` }} />
    </div>
  );
}

export function Markdown({ md }: { md: string }) {
  return (
    <div className="prose-sci">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Unwrap ```mermaid / ```chart blocks so the chart isn't nested in <pre>.
          pre({ children }) {
            const child: any = Array.isArray(children) ? children[0] : children;
            const cls: string = child?.props?.className || "";
            if (/language-(mermaid|chart)/.test(cls)) return <>{child}</>;
            return <pre className="report-pre overflow-x-auto">{children}</pre>;
          },
          code({ className, children, ...props }) {
            const lang = /language-(\w+)/.exec(className || "")?.[1];
            const text = String(children).replace(/\n$/, "");
            if (lang === "mermaid") return <Mermaid chart={text} />;
            if (lang === "chart") return <ReportChart raw={text} />;
            return <code className={className} {...props}>{children}</code>;
          },
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}

export function Loader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-16 text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500/30 border-t-brand-400" />
      {label}…
    </div>
  );
}

/** Subtle explanatory callout — used to orient newcomers on each visualization. */
export function InfoNote({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mb-4 flex gap-2.5 rounded-xl border border-brand-500/20 bg-brand-500/[0.06] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-muted">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
      <div>
        {title && <span className="font-semibold text-fg">{title} </span>}
        {children}
      </div>
    </div>
  );
}

export function Empty({ icon, title, hint }: { icon?: LucideIcon; title: string; hint?: string }) {
  const Icon = icon ?? Telescope;
  return (
    <div className="card flex flex-col items-center gap-3 py-16 text-center">
      <Icon className="h-9 w-9 text-faint" strokeWidth={1.5} />
      <div className="text-base font-semibold text-fg">{title}</div>
      {hint && <div className="max-w-md text-sm text-faint">{hint}</div>}
    </div>
  );
}

export function Section({ title, action, children, className = "" }: {
  title: ReactNode; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-fg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
