import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, ExternalLink, Sun, Moon,
  Users, Trophy, BookOpen, ShieldCheck, Share2, Zap, type LucideIcon,
} from "lucide-react";
import { useReveal, useTheme } from "../lib/hooks";

const GH = "https://github.com/duckyquang/Co-Scientist";

const STEPS: { n: string; title: string; body: string }[] = [
  { n: "01", title: "Generate hypotheses",
    body: "The Generation agent proposes candidate hypotheses, grounded in a live search of the published literature." },
  { n: "02", title: "Run the Elo tournament",
    body: "The Ranking agent stages pairwise debates between hypotheses. Winners gain Elo; the field sorts itself by merit." },
  { n: "03", title: "Evolve the best",
    body: "The Evolution agent combines and refines top-ranked ideas into stronger successor hypotheses." },
  { n: "04", title: "Stress-test the leaders",
    body: "The Reflection agent reviews the strongest hypotheses for novelty, correctness, and testability, flagging weak points." },
  { n: "05", title: "Ranked proposal with citations",
    body: "The Meta-review agent synthesizes a final research overview with numbered references you can verify." },
];

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Users, title: "Six specialized agents",
    body: "Generation, Reflection, Ranking, Evolution, Proximity, and Meta-review — each with a distinct role in the pipeline." },
  { icon: Trophy, title: "Live Elo tournament",
    body: "Hypotheses compete in head-to-head debates. Watch the rankings update match by match." },
  { icon: BookOpen, title: "Real citations",
    body: "Grounded in keyless public APIs: OpenAlex, PubMed, arXiv, and Europe PMC." },
  { icon: ShieldCheck, title: "Self-critique & stress-testing",
    body: "Every hypothesis is reviewed for novelty, correctness, and testability before it ranks." },
  { icon: Share2, title: "Shareable proposal",
    body: "Each run produces a formatted, printable research proposal you can share as its own page." },
  { icon: Zap, title: "Runs free in your browser",
    body: "A zero-config in-browser simulation — or bring your own Groq key for live reasoning." },
];

/** Wraps children in a scroll-reveal container (see .reveal in index.css). */
function Reveal({ className = "", children }: { className?: string; children: ReactNode }) {
  const ref = useReveal<HTMLDivElement>();
  return <div ref={ref} className={`reveal ${className}`}>{children}</div>;
}

/** Marketing landing page — single scroll, GEML aesthetic, chrome-less. */
export default function Landing() {
  const [theme, setTheme] = useTheme();

  return (
    <div className="min-h-screen">
      {/* Masthead */}
      <header className="sticky top-0 z-30 border-b border-rule bg-paper">
        <div className="mx-auto flex h-[52px] max-w-5xl items-center gap-4 px-5">
          <Link to="/" className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-ink">
            Co-Scientist
          </Link>
          <nav className="ml-auto flex items-center gap-2 sm:gap-3">
            <a href={GH} target="_blank" rel="noreferrer noopener"
              className="hidden items-center gap-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-soft hover:text-ink sm:inline-flex">
              GitHub <ExternalLink className="h-3 w-3" />
            </a>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="p-1.5 text-ink-soft hover:text-ink">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <Link to="/chat" className="btn-primary h-8 px-3">
              Launch demo <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-5xl px-5 pt-16 pb-14 sm:pt-24 sm:pb-20">
          <Reveal>
            <div className="w-fit border-b-2 border-accent pb-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-soft">
              Multi-agent hypothesis engine
            </div>
            <h1 className="mt-6 max-w-3xl font-serif font-semibold leading-[1.08] tracking-[-0.01em] text-ink"
              style={{ fontSize: "clamp(2rem,5.5vw,3.4rem)" }}>
              Turn a research question into <em className="italic text-accent">tournament-ranked</em> hypotheses.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-soft">
              Co-Scientist runs six specialized AI agents that generate hypotheses, debate them
              head-to-head in an Elo tournament, and return a ranked proposal with real citations.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/chat" className="btn-primary h-11 px-6 text-[13px]">
                Launch the demo <ArrowRight className="h-4 w-4" />
              </Link>
              <a href={GH} target="_blank" rel="noreferrer noopener" className="btn-ghost h-11 px-6 text-[13px]">
                View on GitHub <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <p className="mt-5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-soft">
              Free · runs in your browser · no key, no account
            </p>
          </Reveal>
        </section>

        {/* How it works */}
        <section className="border-t border-rule">
          <div className="mx-auto max-w-5xl px-5 py-16">
            <Reveal>
              <h2 className="font-serif text-2xl font-semibold text-ink">
                <span className="sec-no">§</span>How it works
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft">
                From a one-line goal to a ranked, cited proposal — five stages, fully automated.
              </p>
            </Reveal>
            <Reveal className="mt-10">
              <ol className="relative">
                {STEPS.map((s, i) => (
                  <li key={s.n} className="relative flex gap-5 pb-9 last:pb-0">
                    {i < STEPS.length - 1 && (
                      <span aria-hidden className="absolute left-[5px] top-3 h-full w-px bg-rule" />
                    )}
                    <span className="tl-dot relative z-10 mt-1" />
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2.5">
                        <span className="num text-[11px] text-accent">{s.n}</span>
                        <h3 className="font-serif text-lg font-semibold text-ink">{s.title}</h3>
                      </div>
                      <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-soft">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>
        </section>

        {/* Features */}
        <section className="border-t border-rule">
          <div className="mx-auto max-w-5xl px-5 py-16">
            <Reveal>
              <h2 className="font-serif text-2xl font-semibold text-ink">
                <span className="sec-no">§</span>What&rsquo;s inside
              </h2>
            </Reveal>
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <Reveal key={f.title}>
                    <div className="card h-full p-5">
                      <Icon className="h-5 w-5 text-blue" strokeWidth={1.75} />
                      <h3 className="mt-3 font-serif text-base font-semibold text-ink">{f.title}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{f.body}</p>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* Honest framing + closing CTA */}
        <section className="border-t border-rule">
          <div className="mx-auto max-w-3xl px-5 py-16 text-center">
            <Reveal>
              <p className="font-serif text-lg leading-relaxed text-ink">
                An open-source re-implementation of Google&rsquo;s{" "}
                <em className="italic text-accent">AI co-scientist</em>. Runs a free in-browser
                simulation, or bring your own key for live reasoning.
              </p>
              <p className="mt-3 text-sm text-ink-soft">
                Independent project — not affiliated with Google or the paper&rsquo;s authors.
              </p>
              <div className="mt-8">
                <Link to="/chat" className="btn-primary h-11 px-6 text-[13px]">
                  Launch the demo <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-5 py-8 sm:flex-row">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-soft">
            Co-Scientist
          </span>
          <div className="flex items-center gap-5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-soft">
            <a href={GH} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-ink">
              GitHub <ExternalLink className="h-3 w-3" />
            </a>
            <a href={`${GH}/blob/main/LICENSE`} target="_blank" rel="noreferrer noopener" className="hover:text-ink">
              Apache-2.0
            </a>
            <span>by Quang Bui</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
