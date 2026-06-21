import type { Scores } from "../types";

export function Sparkline({
  values, width = 120, height = 34, stroke = "#3b82f6", fill = true,
}: { values: number[]; width?: number; height?: number; stroke?: string; fill?: boolean }) {
  if (values.length < 2) {
    return <div className="text-[11px] text-slate-500">—</div>;
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
  const id = "sg" + stroke.replace("#", "");
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
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={thickness} />
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
          fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="1"
        />
      ))}
      {axes.map((_, i) => {
        const [x, y] = point(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.07)" />;
      })}
      <polygon points={poly} fill="rgba(59,130,246,0.20)" stroke="#3b82f6" strokeWidth="2" />
      {vals.map((v, i) => {
        const [x, y] = point(i, v);
        return <circle key={i} cx={x} cy={y} r="3" fill="#60a5fa" />;
      })}
      {axes.map((a, i) => {
        const [x, y] = point(i, 1.22);
        return (
          <text key={a.key} x={x} y={y} fontSize="9.5" fill="#94a3b8"
            textAnchor="middle" dominantBaseline="middle" className="font-semibold uppercase">
            {a.label}
          </text>
        );
      })}
    </svg>
  );
}

export function ScoreBars({ scores }: { scores: Scores }) {
  const rows = [
    { key: "novelty", label: "Novelty", color: "#60a5fa" },
    { key: "correctness", label: "Correctness", color: "#3b82f6" },
    { key: "testability", label: "Testability", color: "#93c5fd" },
    { key: "feasibility", label: "Feasibility", color: "#2563eb" },
  ] as const;
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const v = (scores[r.key] ?? null) as number | null;
        return (
          <div key={r.key} className="flex items-center gap-3">
            <div className="w-24 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{r.label}</div>
            <div className="h-2 flex-1 rounded-full bg-white/[0.06] overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${(v ?? 0) * 100}%`, background: r.color }} />
            </div>
            <div className="w-9 text-right text-xs font-mono text-slate-300">
              {v == null ? "—" : v.toFixed(2)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Multi-line Elo race chart. series: id -> [{i, elo}] */
export function EloRace({
  series, height = 220, highlight,
}: { series: Record<string, { i: number; elo: number }[]>; height?: number; highlight?: string }) {
  const entries = Object.entries(series).filter(([, v]) => v.length > 1);
  if (!entries.length) return <div className="text-sm text-slate-500">Not enough matches yet.</div>;
  const allElo = entries.flatMap(([, v]) => v.map((p) => p.elo));
  const maxI = Math.max(...entries.flatMap(([, v]) => v.map((p) => p.i)));
  const min = Math.min(...allElo) - 5;
  const max = Math.max(...allElo) + 5;
  const W = 760;
  const H = height;
  const pad = { l: 38, r: 12, t: 12, b: 22 };
  const x = (i: number) => pad.l + (i / (maxI || 1)) * (W - pad.l - pad.r);
  const y = (e: number) => pad.t + (1 - (e - min) / (max - min || 1)) * (H - pad.t - pad.b);
  const palette = ["#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af", "#1e3a8a"];
  const ticks = 4;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {Array.from({ length: ticks + 1 }).map((_, k) => {
        const e = min + ((max - min) * k) / ticks;
        const yy = y(e);
        return (
          <g key={k}>
            <line x1={pad.l} y1={yy} x2={W - pad.r} y2={yy} stroke="rgba(255,255,255,0.06)" />
            <text x={4} y={yy + 3} fontSize="9" fill="#64748b" className="font-mono">{Math.round(e)}</text>
          </g>
        );
      })}
      {entries.map(([id, v], idx) => {
        const isHi = highlight && id === highlight;
        const color = isHi ? "#60a5fa" : palette[idx % palette.length];
        const d = v.map((p, i) => `${i ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.elo).toFixed(1)}`).join(" ");
        return (
          <path key={id} d={d} fill="none" stroke={color}
            strokeWidth={isHi ? 3 : 1.6} opacity={highlight && !isHi ? 0.3 : 0.9}
            strokeLinecap="round" strokeLinejoin="round" />
        );
      })}
    </svg>
  );
}
