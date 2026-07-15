import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Printer, Link2, Sun, Moon, Check, Sparkles } from "lucide-react";
import { api } from "../api";
import { Loader, Markdown, slugify } from "../components/ui";
import { HeroArt } from "../components/report/HeroArt";
import { useTheme } from "../lib/hooks";

/** Parse the report markdown into a hero (title + goal) and its ## sections. */
function parseReport(md: string) {
  const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim() || "Research proposal";
  const goal = md.match(/\*\*Research goal\.\*\*\s*(.+)/)?.[1]?.trim() || "";
  const sections = [...md.matchAll(/^##\s+(.+)$/gm)].map((m) => {
    // Strip inline markdown (links) so the display + slug match the rendered
    // heading's text/id (react-markdown ids come from the visible text).
    const t = m[1].trim().replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    return { title: t, slug: slugify(t) };
  });
  // Body starts at the first "## " so the hero owns the title + goal.
  const i = md.indexOf("\n## ");
  const body = i >= 0 ? md.slice(i + 1) : md;
  return { title, goal, sections, body };
}

/** Full-screen, bold "landing page" rendering of the research proposal. Reuses
 *  the shared Markdown renderer (charts / Mermaid / KaTeX) inside a designed
 *  hero + table-of-contents + magazine layout. Paints over the app chrome. */
export default function Microsite() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [theme, setTheme] = useTheme();
  const [md, setMd] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.overview(id).then(setMd).catch(() => setMissing(true));
  }, [id]);

  // Arriving via ?print=1 (the session's Print/PDF button) auto-opens the
  // print dialog once the markdown is in. Mermaid/chart figures render async
  // (dynamic import + async render) after the markdown mounts, so wait a beat
  // first. The guard is set inside the timeout so StrictMode's dev
  // double-effect (which clears the first timer) still prints exactly once.
  const [search] = useSearchParams();
  const printedRef = useRef(false);
  useEffect(() => {
    if (search.get("print") !== "1" || !md || printedRef.current) return;
    const t = setTimeout(() => {
      printedRef.current = true;
      window.print();
    }, 600);
    return () => clearTimeout(t);
  }, [search, md]);

  const parsed = useMemo(() => (md ? parseReport(md) : null), [md]);

  if (missing) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-paper p-6 text-center">
        <div>
          <h1 className="font-serif text-lg font-semibold text-ink">No proposal yet</h1>
          <p className="mt-1 text-sm text-ink-soft">This session hasn't produced a final report.</p>
          <button onClick={() => nav(`/s/${id}`)} className="btn-ghost mt-4">← Back to session</button>
        </div>
      </div>
    );
  }
  if (!parsed) {
    return <div className="fixed inset-0 z-50 grid place-items-center bg-paper"><Loader label="Building your website" /></div>;
  }

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="microsite fixed inset-0 z-50 overflow-y-auto bg-paper">
      {/* Toolbar */}
      <div className="no-print sticky top-0 z-10 flex items-center gap-2 border-b border-rule bg-paper px-4 py-2.5">
        <button onClick={() => nav(`/s/${id}`)} className="btn-ghost h-8">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="ml-1 flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
          <Sparkles className="h-3.5 w-3.5 text-blue" /> Research proposal
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme" className="btn-ghost h-8 w-8 px-0">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button onClick={copyLink} className="btn-ghost h-8">
            {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Link2 className="h-3.5 w-3.5" /> Copy link</>}
          </button>
          <button onClick={() => window.print()} className="btn-primary h-8">
            <Printer className="h-3.5 w-3.5" /> Print / PDF
          </button>
        </div>
      </div>

      {/* Hero */}
      <header className="hero-band relative overflow-hidden px-6 py-16 sm:py-20">
        <HeroArt className="pointer-events-none absolute right-[-40px] top-6 h-64 w-[520px] opacity-70 sm:opacity-90" />
        <div className="relative mx-auto max-w-4xl">
          {/* The hero band is always dark (ink in light, card in dark), so its
              text is fixed light in both themes; print overrides it to ink. */}
          <span className="hero-badge inline-flex items-center gap-1.5 border px-3 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em]">
            <Sparkles className="h-3.5 w-3.5" /> AI-generated research proposal
          </span>
          {/* Lead with the research goal — the compelling subject — not the
              generic "Research proposal" H1. */}
          <h1 className="mt-5 max-w-3xl font-serif text-3xl font-semibold leading-[1.12] tracking-[-0.01em] text-[#f2f5fa] sm:text-[42px]">
            {parsed.goal || parsed.title}
          </h1>
          <p className="mt-4 max-w-2xl font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-[#a3adc2]">
            {parsed.sections.length} sections · charts, lineage, and next-step experiments
          </p>
        </div>
      </header>

      {/* Body + table of contents */}
      <div className="mx-auto max-w-5xl px-6 py-10 lg:grid lg:grid-cols-[200px_1fr] lg:gap-10">
        {parsed.sections.length > 1 && (
          <nav className="no-print mb-8 lg:sticky lg:top-20 lg:mb-0 lg:self-start">
            <div className="label mb-2">Contents</div>
            <ul className="space-y-1">
              {parsed.sections.map((s, i) => (
                <li key={`${s.slug}-${i}`}>
                  <a href={`#${s.slug}`}
                    className="block border-l-2 border-transparent px-2 py-1 text-[12.5px] text-ink-soft transition-colors hover:border-accent hover:text-ink">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <article className="min-w-0">
          <Markdown md={parsed.body} />
          <div className="mt-14 border-t border-rule pt-6 text-center font-mono text-[11px] uppercase tracking-[0.08em] text-ink-soft">
            Generated by <span className="font-semibold text-ink">Co-Scientist</span> · a multi-agent hypothesis tournament
          </div>
        </article>
      </div>
    </div>
  );
}
