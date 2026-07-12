import { Donut, EloRace, ScoreBars } from "../charts";
import type { Scores } from "../../types";

/** A ```chart fenced block in a report: JSON spec → an existing SVG chart.
 *  Kept intentionally small — three shapes cover every figure the report emits.
 *  Copied markdown always pairs the chart with a table, so a raw JSON block that
 *  fails to parse degrades to nothing critical (the table above it carries the data). */
type Spec =
  | { type: "scores"; title?: string; proposals: { label: string; scores: Scores }[] }
  | { type: "donut"; title?: string; segments: { label: string; value: number; color?: string }[] }
  | { type: "elo"; title?: string; series: Record<string, { i: number; elo: number }[]>; labels?: Record<string, string> };

const DONUT_COLORS = ["#3b82f6", "#34d399", "#f59e0b", "#60a5fa", "#a78bfa", "#f472b6", "#2dd4bf", "#fb7185"];

export function ReportChart({ raw }: { raw: string }) {
  let spec: Spec | null = null;
  try { spec = JSON.parse(raw); } catch { return null; }
  if (!spec || typeof spec !== "object") return null;

  return (
    <figure className="report-figure my-4 rounded-xl border border-line bg-surface-2/40 p-4">
      {spec.title && (
        <figcaption className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-faint">
          {spec.title}
        </figcaption>
      )}
      {spec.type === "scores" && (
        <div className="grid gap-4 sm:grid-cols-2">
          {spec.proposals.map((p, i) => (
            <div key={i}>
              <div className="mb-1.5 truncate text-[12.5px] font-semibold text-fg">{p.label}</div>
              <ScoreBars scores={p.scores} />
            </div>
          ))}
        </div>
      )}
      {spec.type === "donut" && (
        <div className="flex flex-wrap items-center gap-6">
          <Donut segments={spec.segments.map((s, i) => ({
            value: s.value, color: s.color || DONUT_COLORS[i % DONUT_COLORS.length], label: s.label,
          }))} />
          <div className="flex-1 space-y-1.5">
            {spec.segments.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-[12.5px]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color || DONUT_COLORS[i % DONUT_COLORS.length] }} />
                <span className="text-muted">{s.label}</span>
                <span className="ml-auto font-mono text-faint">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {spec.type === "elo" && (
        <EloRace series={spec.series} labels={spec.labels} height={200} />
      )}
    </figure>
  );
}
