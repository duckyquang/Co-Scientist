import { useEffect, useRef, useState } from "react";

/** Renders a ```mermaid fenced block to an SVG diagram, theme-aware.
 *  Degrades to the raw source in a <pre> if mermaid can't parse it (so a
 *  copied markdown block is never lost, and a bad diagram never breaks the page). */
export function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // Bumped when the app theme flips, so the diagram re-renders in the new theme.
  const [themeTick, setThemeTick] = useState(0);
  const base = `mmd-${Math.abs(hashCode(chart)).toString(36)}`;

  useEffect(() => {
    const obs = new MutationObserver(() => setThemeTick((n) => n + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const dark = document.documentElement.classList.contains("dark");
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? "dark" : "neutral",
          securityLevel: "strict",
          fontFamily: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
        });
        // Fresh render id each time (mermaid injects a temp node by id — reusing
        // one across theme re-renders can collide).
        const { svg } = await mermaid.render(`${base}-${themeTick}`, chart.trim());
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [chart, themeTick]);

  if (failed) {
    return (
      <pre className="report-pre overflow-x-auto"><code>{chart.trim()}</code></pre>
    );
  }
  return (
    <div
      ref={ref}
      className="my-4 flex justify-center overflow-x-auto border border-rule bg-card p-4 [&_svg]:max-w-full [&_svg]:h-auto"
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
