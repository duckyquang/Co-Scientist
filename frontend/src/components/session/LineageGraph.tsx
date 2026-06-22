import { useMemo } from "react";
import { agentColor, eloColor } from "../../lib/format";
import { Empty, InfoNote } from "../ui";
import type { LineageNode } from "../../types";

interface Props {
  nodes: LineageNode[];
  edges: { source: string; target: string }[];
  onSelect: (id: string) => void;
}

/**
 * Evolution lineage: generation hypotheses are roots; evolution offspring link
 * back to their parents. Laid out in depth tiers (longest path from a root).
 */
export function LineageGraph({ nodes, edges, onSelect }: Props) {
  const layout = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const parents = new Map<string, string[]>();
    const children = new Map<string, string[]>();
    nodes.forEach((n) => { parents.set(n.id, []); children.set(n.id, []); });
    edges.forEach((e) => {
      if (byId.has(e.source) && byId.has(e.target)) {
        parents.get(e.target)!.push(e.source);
        children.get(e.source)!.push(e.target);
      }
    });
    // depth = longest parent chain
    const depth = new Map<string, number>();
    const calc = (id: string, seen: Set<string>): number => {
      if (depth.has(id)) return depth.get(id)!;
      if (seen.has(id)) return 0;
      seen.add(id);
      const ps = parents.get(id) || [];
      const d = ps.length ? Math.max(...ps.map((p) => calc(p, seen))) + 1 : 0;
      depth.set(id, d);
      return d;
    };
    nodes.forEach((n) => calc(n.id, new Set()));
    const tiers: Record<number, LineageNode[]> = {};
    nodes.forEach((n) => {
      const d = depth.get(n.id) || 0;
      (tiers[d] ||= []).push(n);
    });
    const maxTier = Math.max(0, ...Object.keys(tiers).map(Number));
    const colW = 230;
    const rowH = 76;
    const pos = new Map<string, { x: number; y: number }>();
    Object.entries(tiers).forEach(([d, arr]) => {
      arr.sort((a, b) => (b.elo || 0) - (a.elo || 0));
      arr.forEach((n, i) => {
        pos.set(n.id, { x: 40 + Number(d) * colW, y: 40 + i * rowH });
      });
    });
    const height = 80 + Math.max(...Object.values(tiers).map((a) => a.length)) * rowH;
    const width = 80 + (maxTier + 1) * colW;
    return { pos, width, height, maxTier };
  }, [nodes, edges]);

  if (nodes.length === 0) return <Empty icon="🌱" title="No hypotheses to chart yet" />;

  return (
    <div>
      <InfoNote title="What is lineage?">
        This maps how ideas <span className="text-white">evolve</span>. Each box is a hypothesis.
        The leftmost boxes are <span className="text-blue-300">original ideas</span> from the
        Generation agent; boxes further right are <span className="text-blue-300">offspring</span>{" "}
        the Evolution agent bred by combining or mutating top-ranked parents. Follow the lines
        left → right to trace an idea's ancestry — the number on each box is its Elo rating.
        Click any box to open it.
      </InfoNote>

      <div className="mb-3 flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: agentColor("generation").hex }} />
          Original (generation)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: agentColor("evolution").hex }} />
          Evolved (offspring)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="8"><path d="M0,4 H22" stroke="rgba(168,85,247,0.6)" strokeWidth="1.6" /></svg>
          parent → offspring
        </span>
      </div>

      <div className="overflow-auto">
      <svg width={Math.max(layout.width, 600)} height={layout.height} className="min-w-full">
        {/* edges */}
        {edges.map((e, i) => {
          const a = layout.pos.get(e.source);
          const b = layout.pos.get(e.target);
          if (!a || !b) return null;
          const mx = (a.x + 170 + b.x) / 2;
          return (
            <path key={i}
              d={`M${a.x + 170},${a.y + 18} C${mx},${a.y + 18} ${mx},${b.y + 18} ${b.x},${b.y + 18}`}
              fill="none" stroke="rgba(168,85,247,0.45)" strokeWidth="1.6" />
          );
        })}
        {/* nodes */}
        {nodes.map((n) => {
          const p = layout.pos.get(n.id);
          if (!p) return null;
          const c = agentColor(n.created_by === "evolution" ? "evolution" : "generation");
          return (
            <g key={n.id} transform={`translate(${p.x},${p.y})`} className="cursor-pointer"
              onClick={() => onSelect(n.id)}>
              <rect width="170" height="38" rx="9" fill="rgba(16,22,42,0.92)"
                stroke={c.hex} strokeWidth="1.3" />
              <rect width="4" height="38" rx="2" fill={c.hex} />
              <text x="12" y="16" fontSize="10.5" fill="#e2e8f0" className="font-semibold">
                {n.title.length > 24 ? n.title.slice(0, 24) + "…" : n.title}
              </text>
              <text x="12" y="29" fontSize="9" fill="#64748b">{n.strategy}</text>
              <text x="158" y="29" fontSize="11" textAnchor="end"
                className={`font-bold ${eloColor(n.elo)}`} fill="currentColor">
                {n.elo ? Math.round(n.elo) : "—"}
              </text>
            </g>
          );
        })}
      </svg>
      </div>
    </div>
  );
}
