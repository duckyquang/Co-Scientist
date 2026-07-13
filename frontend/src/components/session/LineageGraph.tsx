import { useMemo, useState } from "react";
import { Sprout } from "lucide-react";
import { agentColor, eloColor } from "../../lib/format";
import { Empty, InfoNote } from "../ui";
import type { LineageNode } from "../../types";

interface Props {
  nodes: LineageNode[];
  edges: { source: string; target: string }[];
  onSelect: (id: string) => void;
}

const TIER_LABEL = (d: number) =>
  d === 0 ? "Original ideas" : d === 1 ? "Evolved · round 1" : `Evolved · round ${d}`;

/**
 * Evolution lineage: generation hypotheses are roots; evolution offspring link
 * back to their parents. Laid out in depth tiers (longest path from a root).
 */
export function LineageGraph({ nodes, edges, onSelect }: Props) {
  const [hover, setHover] = useState<string | null>(null);

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
    const colW = 240;
    const rowH = 82;
    const topPad = 44;
    const pos = new Map<string, { x: number; y: number }>();
    Object.entries(tiers).forEach(([d, arr]) => {
      arr.sort((a, b) => (b.elo || 0) - (a.elo || 0));
      arr.forEach((n, i) => {
        pos.set(n.id, { x: 40 + Number(d) * colW, y: topPad + i * rowH });
      });
    });
    const height = topPad + 40 + Math.max(...Object.values(tiers).map((a) => a.length)) * rowH;
    const width = 80 + (maxTier + 1) * colW;
    return { pos, width, height, maxTier, parents, children };
  }, [nodes, edges]);

  // Which nodes/edges to emphasize: the hovered node plus its full ancestry+descendants.
  const related = useMemo(() => {
    if (!hover) return null;
    const keep = new Set<string>([hover]);
    const walk = (id: string, map: Map<string, string[]>) => {
      for (const nx of map.get(id) || []) if (!keep.has(nx)) { keep.add(nx); walk(nx, map); }
    };
    walk(hover, layout.parents);
    walk(hover, layout.children);
    return keep;
  }, [hover, layout]);

  if (nodes.length === 0) return <Empty icon={Sprout} title="No hypotheses to chart yet" />;

  return (
    <div>
      <InfoNote title="What is lineage?">
        This traces how ideas <span className="text-ink font-semibold">evolve</span>. Boxes in the{" "}
        <span className="text-ink font-semibold">first column</span> are original hypotheses from the
        Generation agent; each column to the right is a round of{" "}
        <span className="text-ink font-semibold">offspring</span> the Evolution agent bred from top parents.
        Hover a box to light up its ancestry; the number is its Elo rating. Click to open it.
      </InfoNote>

      <div className="overflow-auto">
        <svg width={Math.max(layout.width, 600)} height={layout.height} className="min-w-full">
          {/* tier headers */}
          {Array.from({ length: layout.maxTier + 1 }).map((_, d) => (
            <text key={d} x={40 + d * 240} y={24} fontSize="10.5"
              className="font-mono uppercase" fill="var(--ink-soft)" letterSpacing="0.12em">
              {TIER_LABEL(d)}
            </text>
          ))}
          {/* edges */}
          {edges.map((e, i) => {
            const a = layout.pos.get(e.source);
            const b = layout.pos.get(e.target);
            if (!a || !b) return null;
            const on = !related || (related.has(e.source) && related.has(e.target));
            const mx = (a.x + 180 + b.x) / 2;
            return (
              <path key={i}
                d={`M${a.x + 180},${a.y + 19} C${mx},${a.y + 19} ${mx},${b.y + 19} ${b.x},${b.y + 19}`}
                fill="none" stroke={on ? "var(--green)" : "var(--ink-soft)"}
                strokeWidth={on ? 1.8 : 1.1} opacity={on ? 0.75 : 0.3} />
            );
          })}
          {/* nodes */}
          {nodes.map((n) => {
            const p = layout.pos.get(n.id);
            if (!p) return null;
            const c = agentColor(n.created_by === "evolution" ? "evolution" : "generation");
            const dim = related && !related.has(n.id);
            return (
              <g key={n.id} transform={`translate(${p.x},${p.y})`} className="cursor-pointer"
                opacity={dim ? 0.35 : 1}
                onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                onClick={() => onSelect(n.id)}>
                <rect width="180" height="40" rx="0" fill="var(--card)"
                  stroke={hover === n.id ? "var(--green)" : c.hex} strokeWidth={hover === n.id ? 2 : 1.3} />
                <rect width="4" height="40" fill={c.hex} />
                <text x="13" y="17" fontSize="10.5" fill="var(--ink)" className="font-semibold">
                  {n.title.length > 26 ? n.title.slice(0, 26) + "…" : n.title}
                </text>
                <text x="13" y="31" fontSize="9" fill="var(--ink-soft)" className="font-mono">{n.strategy}</text>
                <text x="168" y="31" fontSize="11.5" textAnchor="end"
                  className={`font-mono font-bold ${eloColor(n.elo)}`} fill="currentColor">
                  {n.elo ? Math.round(n.elo) : "—"}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5" style={{ background: agentColor("generation").hex }} />
          Original (generation)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5" style={{ background: agentColor("evolution").hex }} />
          Evolved (offspring)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="8"><path d="M0,4 H22" stroke="var(--green)" strokeWidth="1.8" /></svg>
          parent → offspring
        </span>
      </div>
    </div>
  );
}
