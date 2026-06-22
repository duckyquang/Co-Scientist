import { useMemo, useState } from "react";
import { STRATEGY_ICON } from "../../lib/format";
import { Empty, InfoNote } from "../ui";
import type { ClusterPoint } from "../../types";

const CLUSTER_COLORS = [
  "#3b82f6", "#60a5fa", "#93c5fd", "#bfdbfe", "#2563eb",
  "#1d4ed8", "#1e40af", "#eff6ff", "#dbeafe", "#1e3a8a",
];

/** Proximity map: 2D projection of hypotheses, grouped by dedup cluster.
 *  Marker size ∝ Elo, color = cluster. Hover for details. */
export function ClusterMap({
  points, onSelect,
}: { points: ClusterPoint[]; onSelect: (id: string) => void }) {
  const [hover, setHover] = useState<ClusterPoint | null>(null);
  const W = 720, H = 460, pad = 40;

  const { mapped, clusterList, name } = useMemo(() => {
    const clusters = Array.from(new Set(points.map((p) => p.cluster))).sort();
    const color = (c: string) => CLUSTER_COLORS[clusters.indexOf(c) % CLUSTER_COLORS.length];
    // Friendly display label — backend cluster ids look like "clu_0".
    const name = (c: string) => `Theme ${clusters.indexOf(c) + 1}`;
    const eloVals = points.map((p) => p.elo || 1200);
    const eMin = Math.min(...eloVals, 1200), eMax = Math.max(...eloVals, 1201);
    const mapped = points.map((p) => ({
      ...p,
      sx: pad + ((p.x + 1) / 2) * (W - pad * 2),
      sy: pad + ((p.y + 1) / 2) * (H - pad * 2),
      r: 7 + ((p.elo || 1200) - eMin) / (eMax - eMin || 1) * 13,
      color: color(p.cluster),
    }));
    return { mapped, name, clusterList: clusters.map((c) => ({ c, color: color(c), count: points.filter((p) => p.cluster === c).length })) };
  }, [points]);

  if (points.length === 0) return <Empty icon="🛰️" title="No hypotheses to map yet" />;

  return (
    <div>
      <InfoNote title="What is this map?">
        Each dot is a hypothesis, placed so that ideas exploring the{" "}
        <span className="text-white">same underlying theme sit close together</span> (a
        "cluster"). Bigger dots have a higher Elo rating; <span className="text-white">📌</span>{" "}
        marks a pinned favorite. Use it to spot where the agents are converging — and which
        themes are still unexplored. Click any dot to read the full hypothesis.
      </InfoNote>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl border border-white/[0.06] grid-bg">
          {/* cluster hulls (soft glow per cluster centroid) */}
          {clusterList.map(({ c, color }) => {
            const pts = mapped.filter((p) => p.cluster === c);
            const cx = pts.reduce((s, p) => s + p.sx, 0) / pts.length;
            const cy = pts.reduce((s, p) => s + p.sy, 0) / pts.length;
            return <circle key={c} cx={cx} cy={cy} r={70} fill={color} opacity={0.06} />;
          })}
          {/* links within cluster to centroid */}
          {clusterList.map(({ c }) => {
            const pts = mapped.filter((p) => p.cluster === c);
            const cx = pts.reduce((s, p) => s + p.sx, 0) / pts.length;
            const cy = pts.reduce((s, p) => s + p.sy, 0) / pts.length;
            return pts.map((p) => (
              <line key={p.id} x1={cx} y1={cy} x2={p.sx} y2={p.sy}
                stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            ));
          })}
          {mapped.map((p) => (
            <g key={p.id} className="cursor-pointer"
              onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}
              onClick={() => onSelect(p.id)}>
              <circle cx={p.sx} cy={p.sy} r={p.r} fill={p.color}
                fillOpacity={hover?.id === p.id ? 0.95 : 0.7}
                stroke={p.color} strokeWidth={hover?.id === p.id ? 3 : 1}
                strokeOpacity={0.9} />
              {p.state === "pinned" && (
                <text x={p.sx} y={p.sy + 3.5} fontSize="11" textAnchor="middle">📌</text>
              )}
            </g>
          ))}
        </svg>
        {hover && (
          <div className="pointer-events-none absolute left-3 top-3 max-w-xs rounded-lg border border-white/10 bg-ink-950/95 p-3 shadow-xl">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">
              {STRATEGY_ICON[hover.strategy]} {hover.strategy} · {name(hover.cluster)}
            </div>
            <div className="mt-1 text-sm font-semibold text-white">{hover.title}</div>
            <div className="mt-1 text-xs text-slate-400">
              Elo {hover.elo ? Math.round(hover.elo) : "—"} · {hover.matches_played} matches
            </div>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <span className="text-slate-500">Themes:</span>
        {clusterList.map(({ c, color, count }) => (
          <span key={c} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
            {name(c)} <span className="text-slate-600">({count})</span>
          </span>
        ))}
        <span className="ml-auto text-slate-500">dot size ∝ Elo · click to inspect</span>
      </div>
    </div>
  );
}
