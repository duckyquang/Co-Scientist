/** Decorative, self-contained hero illustration: an abstract "idea network" of
 *  nodes and links with a soft particle field. Pure inline SVG (no external
 *  assets), tuned to sit behind the gradient hero. Deterministic layout. */
export function HeroArt({ className = "" }: { className?: string }) {
  // A small fixed constellation — enough to read as a network without noise.
  const nodes = [
    [60, 70], [150, 40], [230, 110], [120, 150], [300, 60],
    [360, 140], [280, 190], [190, 210], [420, 90], [90, 210],
  ] as const;
  const links = [
    [0, 1], [1, 2], [2, 3], [0, 3], [1, 4], [4, 5], [5, 6],
    [2, 6], [6, 7], [3, 7], [7, 9], [4, 8], [5, 8],
  ] as const;

  return (
    <svg viewBox="0 0 480 240" fill="none" className={className} aria-hidden="true">
      {links.map(([a, b], i) => (
        <line key={i}
          x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]}
          stroke="white" strokeOpacity="0.35" strokeWidth="1.2" />
      ))}
      {nodes.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={i % 3 === 0 ? 6 : 4} fill="white" fillOpacity="0.9">
            <animate attributeName="fill-opacity"
              values="0.5;1;0.5" dur={`${2.4 + (i % 4) * 0.6}s`}
              repeatCount="indefinite" begin={`${i * 0.2}s`} />
          </circle>
          <circle cx={x} cy={y} r={i % 3 === 0 ? 12 : 9} fill="white" fillOpacity="0.12" />
        </g>
      ))}
    </svg>
  );
}
