import { useEffect, useRef, useState } from "react";

/** Renders a ```mermaid fenced block to an SVG diagram, theme-aware.
 *  Degrades to the raw source in a <pre> if mermaid can't parse it (so a
 *  copied markdown block is never lost, and a bad diagram never breaks the page). */
export function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // Unique-per-instance id without Math.random at module scope.
  const idRef = useRef(`mmd-${Math.abs(hashCode(chart)).toString(36)}`);

  useEffect(() => {
    let cancelled = false;
    const dark = document.documentElement.classList.contains("dark");
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? "dark" : "neutral",
          securityLevel: "strict",
          fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        });
        const { svg } = await mermaid.render(idRef.current, chart.trim());
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [chart]);

  if (failed) {
    return (
      <pre className="report-pre overflow-x-auto"><code>{chart.trim()}</code></pre>
    );
  }
  return (
    <div
      ref={ref}
      className="my-4 flex justify-center overflow-x-auto rounded-xl border border-line bg-surface-2/40 p-4 [&_svg]:max-w-full [&_svg]:h-auto"
      role="img"
      aria-label="diagram"
    />
  );
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
