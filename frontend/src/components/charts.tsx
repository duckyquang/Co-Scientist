import { useState } from "react";
import type { Scores } from "../types";

export function Sparkline({
  values, width = 120, height = 34, stroke = "var(--blue)", fill = true,
}: { values: number[]; width?: number; height?: number; stroke?: string; fill?: boolean }) {
  if (values.length < 2) {
    return <div className="text-[11px] text-ink-soft">—</div>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const id = "sg" + stroke.replace(/[^a-z0-9-]/gi, "");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && (
        <path d={`${d} L${last[0]},${height} L${pts[0][0]},${height} Z`} fill={`url(#${id})`} />
      )}
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={stroke} />
    </svg>
  );
}

export function Donut({
  segments, size = 132, thickness = 18,
}: { segments: { value: number; color: string; label: string }[]; size?: number; thickness?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--grid)" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const len = (s.value / total) * c;
          const el = (
            <circle
              key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color}
              strokeWidth={thickness} strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset} strokeLinecap="butt"
            />
          );
          offset += len;
          return el;
        })}
      </g>
    </svg>
  );
}

export function ScoreRadar({ scores, size = 168 }: { scores: Scores; size?: number }) {
  const axes = [
    { key: "novelty", label: "Novelty" },
    { key: "correctness", label: "Correct" },
    { key: "testability", label: "Testable" },
    { key: "feasibility", label: "Feasible" },
  ] as const;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 30;
  const angle = (i: number) => (Math.PI * 2 * i) / axes.length - Math.PI / 2;
  const point = (i: number, val: number) => [
    cx + Math.cos(angle(i)) * R * val,
    cy + Math.sin(angle(i)) * R * val,
  ];
  const vals = axes.map((a) => (scores[a.key] ?? 0) as number);
  const poly = vals.map((v, i) => point(i, v).join(",")).join(" ");
  const rings = [0.25, 0.5, 0.75, 1];
  return (
    <svg width={size} height={size}>
      {rings.map((rr, i) => (
        <polygon
          key={i}
          points={axes.map((_, j) => point(j, rr).join(",")).join(" ")}
          fill="none" stroke="var(--grid)" strokeWidth="1"
        />
      ))}
      {axes.map((_, i) => {
        const [x, y] = point(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--grid)" />;
      })}
      <polygon points={poly} fill="var(--blue-soft)" stroke="var(--blue)" strokeWidth="2" />
      {vals.map((v, i) => {
        const [x, y] = point(i, v);
        return <circle key={i} cx={x} cy={y} r="3" fill="var(--blue)" />;
      })}
      {axes.map((a, i) => {
        const [x, y] = point(i, 1.22);
        return (
          <text key={a.key} x={x} y={y} fontSize="9.5" fill="var(--ink-soft)"
            textAnchor="middle" dominantBaseline="middle" className="font-mono uppercase">
            {a.label}
          </text>
        );
      })}
    </svg>
  );
}

export function ScoreBars({ scores }: { scores: Scores }) {
  const rows = [
    { key: "novelty", label: "Novelty", color: "var(--chart-1)" },
    { key: "correctness", label: "Correctness", color: "var(--chart-2)" },
    { key: "testability", label: "Testability", color: "var(--chart-3)" },
    { key: "feasibility", label: "Feasibility", color: "var(--chart-4)" },
  ] as const;
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const v = (scores[r.key] ?? null) as number | null;
        return (
          <div key={r.key} className="flex items-center gap-3">
            <div className="w-24 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-soft">{r.label}</div>
            <div className="h-2 flex-1 overflow-hidden bg-[var(--grid)]">
              <div className="h-full transition-all duration-700"
                style={{ width: `${(v ?? 0) * 100}%`, background: r.color }} />
            </div>
            <div className="num w-9 text-right text-xs text-ink-soft">
              {v == null ? "—" : v.toFixed(2)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Multi-line Elo race chart. series: id -> [{i, elo}].
 *  Hover a line (or legend chip) to highlight it; click to open that hypothesis. */
export function EloRace({
  series, height = 220, highlight, onSelect, labels,
}: {
  series: Record<string, { i: number; elo: number }[]>;
  height?: number;
  highlight?: string;
  onSelect?: (id: string) => void;
  labels?: Record<string, string>;
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const entries = Object.entries(series).filter(([, v]) => v.length > 1);
  if (!entries.length) return <div className="text-sm text-ink-soft">Not enough matches yet.</div>;
  const allElo = entries.flatMap(([, v]) => v.map((p) => p.elo));
  const maxI = Math.max(...entries.flatMap(([, v]) => v.map((p) => p.i)));
  const min = Math.min(...allElo) - 5;
  const max = Math.max(...allElo) + 5;
  const W = 760;
  const H = height;
  const pad = { l: 38, r: 12, t: 12, b: 22 };
  const x = (i: number) => pad.l + (i / (maxI || 1)) * (W - pad.l - pad.r);
  const y = (e: number) => pad.t + (1 - (e - min) / (max - min || 1)) * (H - pad.t - pad.b);
  const palette = [
    "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)",
    "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)",
  ];
  const ticks = 4;
  const colorOf = (idx: number) => palette[idx % palette.length];
  const active = hoverId || highlight || null;
  const labelOf = (id: string) => labels?.[id] || id.slice(0, 12);
  const finalElo = (id: string) => {
    const v = series[id];
    return v?.length ? Math.round(v[v.length - 1].elo) : null;
  };

  return (
    <div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          {Array.from({ length: ticks + 1 }).map((_, k) => {
            const e = min + ((max - min) * k) / ticks;
            const yy = y(e);
            return (
              <g key={k}>
                <line x1={pad.l} y1={yy} x2={W - pad.r} y2={yy} stroke="var(--grid)" />
                <text x={4} y={yy + 3} fontSize="9" fill="var(--ink-soft)" className="font-mono">{Math.round(e)}</text>
              </g>
            );
          })}
          {entries.map(([id, v], idx) => {
            const isHi = active === id;
            const color = isHi ? "var(--red)" : colorOf(idx);
            const d = v.map((p, i) => `${i ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.elo).toFixed(1)}`).join(" ");
            const last = v[v.length - 1];
            return (
              <g key={id}>
                <path d={d} fill="none" stroke={color}
                  strokeWidth={isHi ? 3 : 1.6} opacity={active && !isHi ? 0.25 : 0.9}
                  strokeLinecap="round" strokeLinejoin="round" />
                <circle cx={x(last.i)} cy={y(last.elo)} r={isHi ? 4 : 2.5} fill={color}
                  opacity={active && !isHi ? 0.25 : 1} />
                {/* invisible fat hit-area for easy hover/click */}
                {onSelect && (
                  <path d={d} fill="none" stroke="transparent" strokeWidth={14}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoverId(id)} onMouseLeave={() => setHoverId(null)}
                    onClick={() => onSelect(id)} />
                )}
              </g>
            );
          })}
        </svg>
        {active && (
          <div className="pointer-events-none absolute left-3 top-2 max-w-[60%] truncate border border-rule bg-card px-2.5 py-1.5 text-[12px]">
            <span className="font-semibold text-ink">{labelOf(active)}</span>
            <span className="num ml-1.5 text-blue">{finalElo(active)}</span>
          </div>
        )}
      </div>

      {/* clickable legend — also the way to discover what each line is */}
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
        {entries.map(([id], idx) => {
          const isHi = active === id;
          return (
            <button key={id}
              onClick={() => onSelect?.(id)}
              onMouseEnter={() => setHoverId(id)} onMouseLeave={() => setHoverId(null)}
              className={`inline-flex max-w-[230px] items-center gap-1.5 border px-1.5 py-0.5 text-[11px] transition-colors ${
                isHi ? "border-rule bg-card text-ink" : "border-transparent text-ink-soft hover:text-ink"
              }`}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: isHi ? "var(--red)" : colorOf(idx) }} />
              <span className="truncate">{labelOf(id)}</span>
              <span className="num shrink-0 text-ink-soft">{finalElo(id)}</span>
            </button>
          );
        })}
      </div>
      {onSelect && (
        <div className="mt-2 text-[11px] text-ink-soft">Click a line or label to open the hypothesis.</div>
      )}
    </div>
  );
}
