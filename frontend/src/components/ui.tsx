import { Children, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Mermaid } from "./report/Mermaid";
import { ReportChart } from "./report/ReportChart";
import { Telescope, type LucideIcon } from "lucide-react";
import {
  HYP_STATE_STYLE, STATUS_STYLE, agentColor, strategyIcon,
} from "../lib/format";

export function StatusBadge({ status }: { status: string }) {
  const live = status === "running";
  return (
    <span className={`chip ${STATUS_STYLE[status] || STATUS_STYLE.aborted}`}>
      {live && <span className="h-1.5 w-1.5 rounded-full bg-blue animate-pulseDot" />}
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
    <span className="chip chip-mute">
      <Icon className="h-3 w-3" />
      {strategy}
    </span>
  );
}

export function AgentTag({ agent }: { agent: string | null | undefined }) {
  const c = agentColor(agent);
  return (
    <span className="chip chip-mute">
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
      {sub && <div className="mt-0.5 text-xs text-ink-soft">{sub}</div>}
    </div>
  );
}

export function Progress({ value, max, color = "var(--blue)" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden border border-rule bg-[var(--grid)]">
      <div className="h-full transition-all duration-700"
        style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/** Flatten heading children to plain text, for anchor slugs. */
function nodeText(children: ReactNode): string {
  return Children.toArray(children)
    .map((c: any) => (typeof c === "string" ? c : c?.props?.children ? nodeText(c.props.children) : ""))
    .join("");
}
export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/* ── Inline citation links ───────────────────────────────────────
 * Turn bracketed integers ([1], [42]) in body text into links to the matching
 * `## References` entry, and give each reference line a `cite-n` scroll target.
 * Operates on hast (after remark/katex) so it never touches `[H-…]` hypothesis
 * ids, task checkboxes, code spans, or KaTeX math. */
type HNode = {
  type: string; tagName?: string; value?: string;
  properties?: Record<string, unknown>; children?: HNode[];
};
const CITE_RE = /\[(\d+)\]/g;
const SKIP_TAGS = new Set(["code", "pre", "a"]); // don't rewrite code or nest anchors

function hastText(node: HNode): string {
  return node.type === "text" ? node.value || "" : (node.children || []).map(hastText).join("");
}
function isMath(node: HNode): boolean {
  const cn = node.properties?.className;
  const arr = Array.isArray(cn) ? cn : typeof cn === "string" ? [cn] : [];
  return arr.some((c) => typeof c === "string" && (c.includes("katex") || c.includes("math")));
}
/** Split a text value on `[n]`. In the References section the first marker at
 *  the start of a line becomes the target span (id="cite-n"); every other
 *  marker becomes a link to its reference. Returns null when nothing matched. */
function citeSplit(value: string, inRefs: boolean): HNode[] | null {
  CITE_RE.lastIndex = 0;
  const out: HNode[] = [];
  let last = 0, m: RegExpExecArray | null, matched = false;
  while ((m = CITE_RE.exec(value))) {
    if (m.index > last) out.push({ type: "text", value: value.slice(last, m.index) });
    const n = m[1];
    const isEntry = inRefs && !matched && value.slice(0, m.index).trim() === "";
    out.push(isEntry
      ? { type: "element", tagName: "span",
          properties: { id: `cite-${n}`, style: "scroll-margin-top:76px" },
          children: [{ type: "text", value: m[0] }] }
      : { type: "element", tagName: "a",
          properties: { href: `#cite-${n}` }, children: [{ type: "text", value: m[0] }] });
    matched = true;
    last = m.index + m[0].length;
  }
  if (!matched) return null;
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}
function rehypeCitations() {
  return (tree: HNode) => {
    let inRefs = false; // ponytail: References is a flat trailing section; a heading toggles it
    const walk = (node: HNode) => {
      if (!node.children) return;
      if (node.tagName && /^h[1-6]$/.test(node.tagName)) {
        inRefs = hastText(node).trim().toLowerCase() === "references";
      }
      const out: HNode[] = [];
      for (const child of node.children) {
        if (child.type === "text") {
          out.push(...(citeSplit(child.value || "", inRefs) ?? [child]));
        } else {
          if (!(child.tagName && SKIP_TAGS.has(child.tagName)) && !isMath(child)) walk(child);
          out.push(child);
        }
      }
      node.children = out;
    };
    walk(tree);
  };
}

export function Markdown({ md }: { md: string }) {
  return (
    <div className="prose-sci">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeCitations]}
        components={{
          // Slugged ids on headings so a table of contents can anchor-scroll.
          h1: ({ children }) => <h1 id={slugify(nodeText(children))}>{children}</h1>,
          h2: ({ children }) => <h2 id={slugify(nodeText(children))}>{children}</h2>,
          h3: ({ children }) => <h3 id={slugify(nodeText(children))}>{children}</h3>,
          // Unwrap ```mermaid / ```chart blocks so the chart isn't nested in <pre>.
          pre({ children }) {
            const child: any = Array.isArray(children) ? children[0] : children;
            const lang = /language-(\w+)/.exec(child?.props?.className || "")?.[1];
            if (lang === "mermaid" || lang === "chart") return <>{child}</>;
            return <pre className="report-pre overflow-x-auto">{children}</pre>;
          },
          // Drop react-markdown's `node`/extra props so they don't leak onto <code>.
          code({ className, children }) {
            const lang = /language-(\w+)/.exec(className || "")?.[1];
            const text = String(children).replace(/\n$/, "");
            if (lang === "mermaid") return <Mermaid chart={text} />;
            if (lang === "chart") return <ReportChart raw={text} />;
            return <code className={className}>{children}</code>;
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
    <div className="flex items-center gap-3 py-16 text-ink-soft">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-rule border-t-blue" />
      {label}…
    </div>
  );
}

/** Subtle explanatory callout — used to orient newcomers on each visualization. */
export function InfoNote({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mb-4 flex gap-2.5 border border-rule border-l-2 border-l-blue bg-card px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-soft">
      <span className="mt-0.5 shrink-0 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-accent">N.B.</span>
      <div>
        {title && <span className="font-semibold text-ink">{title} </span>}
        {children}
      </div>
    </div>
  );
}

export function Empty({ icon, title, hint }: { icon?: LucideIcon; title: string; hint?: string }) {
  const Icon = icon ?? Telescope;
  return (
    <div className="card flex flex-col items-center gap-3 py-16 text-center">
      <Icon className="h-9 w-9 text-ink-soft" strokeWidth={1.5} />
      <div className="text-base font-semibold text-ink">{title}</div>
      {hint && <div className="max-w-md text-sm text-ink-soft">{hint}</div>}
    </div>
  );
}

export function Section({ title, action, children, className = "", n }: {
  title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; n?: number;
}) {
  return (
    <section className={`card p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-rule pb-3">
        <h2 className="font-serif text-base font-semibold text-ink">
          {n != null && <span className="sec-no">§{n}</span>}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
