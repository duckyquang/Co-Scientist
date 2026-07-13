import { Donut, EloRace, ScoreBars, ScoreRadar } from "../charts";
import type { Scores } from "../../types";

/** A ```chart fenced block in a report: JSON spec → an existing SVG chart.
 *  Kept intentionally small — a few shapes cover every figure the report emits.
 *  Copied markdown always pairs the chart with a table, so a raw JSON block that
 *  fails to parse degrades to nothing critical (the table above it carries the data). */
type Spec =
  | { type: "scores"; title?: string; proposals: { label: string; scores: Scores }[] }
  | { type: "donut"; title?: string; segments: { label: string; value: number; color?: string }[] }
  | { type: "elo"; title?: string; series: Record<string, { i: number; elo: number }[]>; labels?: Record<string, string> }
  | { type: "radar"; title?: string; scores: Scores };

const DONUT_COLORS = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)",
  "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)",
];

export function ReportChart({ raw }: { raw: string }) {
  let spec: Spec | null = null;
  try { spec = JSON.parse(raw); } catch { return null; }
  if (!spec || typeof spec !== "object") return null;

  return (
    <figure className="report-figure my-4 border border-rule bg-card p-4">
      {spec.title && (
        <figcaption className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
          {spec.title}
        </figcaption>
      )}
      {spec.type === "scores" && Array.isArray(spec.proposals) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {spec.proposals.map((p, i) => (
            <div key={i}>
              <div className="mb-1.5 truncate font-serif text-[12.5px] font-semibold text-ink">{p.label}</div>
              <ScoreBars scores={p.scores} />
            </div>
          ))}
        </div>
      )}
      {spec.type === "donut" && Array.isArray(spec.segments) && (
        <div className="flex flex-wrap items-center gap-6">
          <Donut segments={spec.segments.map((s, i) => ({
            value: s.value, color: s.color || DONUT_COLORS[i % DONUT_COLORS.length], label: s.label,
          }))} />
          <div className="flex-1 space-y-1.5">
            {spec.segments.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-[12.5px]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color || DONUT_COLORS[i % DONUT_COLORS.length] }} />
                <span className="text-ink-soft">{s.label}</span>
                <span className="num ml-auto text-ink-soft">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {spec.type === "elo" && spec.series && typeof spec.series === "object" && (
        <EloRace series={spec.series} labels={spec.labels} height={200} />
      )}
      {spec.type === "radar" && spec.scores && typeof spec.scores === "object" && (
        <div className="flex justify-center">
          <ScoreRadar scores={spec.scores} />
        </div>
      )}
    </figure>
  );
}
