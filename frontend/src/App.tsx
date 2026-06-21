import { useState } from "react";
import type { ReactNode } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { CommandPalette } from "./components/CommandPalette";
import { OnboardingModal } from "./components/OnboardingModal";
import { SettingsModal } from "./components/SettingsModal";
import { IS_LOCAL_HOST, IS_STATIC_DEMO } from "./lib/config";
import { getCredentials, getDeploymentMode, isOnboardingDone } from "./lib/credentials";
import { canUseLiveApi } from "./lib/live";
import { useTheme, usePoll } from "./lib/hooks";
import { api } from "./api";
import { timeAgo } from "./lib/format";
import Dashboard from "./pages/Dashboard";
import NewSession from "./pages/NewSession";
import Session from "./pages/Session";
import type { SessionRow } from "./types";

/* ── Mode badge ─────────────────────────────────────────── */
function ModeBadge() {
  if (IS_LOCAL_HOST && !IS_STATIC_DEMO)
    return <span className="badge-pill bg-blue-500/15 text-blue-400">Local</span>;
  if (canUseLiveApi())
    return <span className="badge-pill bg-brand-500/15 text-brand-400">Cloud</span>;
  if (getDeploymentMode() === "local")
    return <span className="badge-pill bg-brand-500/15 text-brand-400">Local AI</span>;
  return <span className="badge-pill bg-zinc-500/15 text-zinc-400">Demo</span>;
}

/* ── Sidebar nav link ───────────────────────────────────── */
function SLink({
  to, children, exact = false,
}: { to: string; children: ReactNode; exact?: boolean }) {
  const loc = useLocation();
  const active = exact ? loc.pathname === to : loc.pathname.startsWith(to);
  return (
    <Link
      to={to}
      className={`nav-item ${active ? "nav-item-active" : ""}`}
    >
      {children}
    </Link>
  );
}

/* ── Sidebar ────────────────────────────────────────────── */
function Sidebar({
  onPalette, onSettings, dark, toggle,
}: {
  onPalette: () => void;
  onSettings: () => void;
  dark: boolean;
  toggle: () => void;
}) {
  const { data: sessions } = usePoll<SessionRow[]>(() => api.sessions(), [], 8000);
  // Only show real user sessions in the sidebar — never demo:: seeded ones
  const recent = (sessions || []).filter((s) => !s.id.startsWith("demo::")).slice(0, 6);

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 px-4">
        <Link to="/" className="flex items-center gap-2 min-w-0">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-600 text-base shadow-glow">
            🧬
          </span>
          <span className="text-[14px] font-bold text-white truncate">Co-Scientist</span>
        </Link>
        <ModeBadge />
      </div>

      {/* Primary nav */}
      <div className="px-3 pt-1 pb-2 space-y-0.5">
        <SLink to="/" exact>
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="none">
            <path d="M2 6.5L8 2l6 4.5V14H10v-3H6v3H2V6.5z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"/>
          </svg>
          Dashboard
        </SLink>
        <Link to="/new" className="nav-item group">
          <span className="grid h-4 w-4 shrink-0 place-items-center rounded bg-brand-600/20 text-brand-400 group-hover:bg-brand-600/30">
            <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </span>
          New session
        </Link>
      </div>

      {/* Recent sessions */}
      {recent.length > 0 && (
        <div className="px-3 pt-3 pb-2">
          <div className="label mb-2 px-2.5">Recent</div>
          <div className="space-y-0.5">
            {recent.map((s) => (
              <SLink key={s.id} to={`/s/${s.id}`}>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  s.status === "running" ? "bg-blue-400 animate-pulseDot" :
                  s.status === "paused"  ? "bg-zinc-400" :
                  s.status === "done"    ? "bg-brand-400" : "bg-zinc-600"
                }`} />
                <span className="truncate text-[12.5px]">
                  {s.research_goal.length > 32
                    ? s.research_goal.slice(0, 32) + "…"
                    : s.research_goal}
                </span>
              </SLink>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1" />

      {/* Bottom utilities */}
      <div className="px-3 pb-4 pt-2 border-t border-white/[0.05] space-y-0.5 mt-2">
        <button
          onClick={onPalette}
          className="nav-item w-full text-left"
        >
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.25"/>
            <path d="m10 10 3.5 3.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
          </svg>
          Search
          <kbd className="ml-auto font-mono text-[10px] text-zinc-600 bg-white/[0.05] px-1.5 py-0.5 rounded">⌘K</kbd>
        </button>
        <button
          onClick={onSettings}
          className="nav-item w-full text-left"
        >
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.25"/>
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
          </svg>
          Settings
        </button>
        <button
          onClick={toggle}
          className="nav-item w-full text-left"
          title="Toggle theme"
        >
          {dark ? (
            <>
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.25"/>
                <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
              </svg>
              Light mode
            </>
          ) : (
            <>
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="none">
                <path d="M13.5 9.5A6 6 0 0 1 6.5 2.5 5.5 5.5 0 1 0 13.5 9.5z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"/>
              </svg>
              Dark mode
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

/* ── Mobile top bar (hidden on md+) ───────────────────────── */
function MobileBar({
  onMenu, dark,
}: { onMenu: () => void; dark: boolean }) {
  return (
    <div className="sticky top-0 z-40 flex h-12 items-center gap-3 border-b border-white/[0.06] bg-ink-950/80 px-4 backdrop-blur-xl md:hidden">
      <button onClick={onMenu} className="p-1 text-zinc-400 hover:text-zinc-200">
        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 10.5a.75.75 0 01.75-.75h7.5a.75.75 0 010 1.5h-7.5a.75.75 0 01-.75-.75zM2 10a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 10z" clipRule="evenodd"/>
        </svg>
      </button>
      <Link to="/" className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand-600 text-sm">🧬</span>
        <span className="text-sm font-bold text-white">Co-Scientist</span>
      </Link>
      <div className="ml-auto">
        <Link to="/new" className="btn-primary h-8 text-xs px-3">+ New</Link>
      </div>
    </div>
  );
}

/* ── Root ───────────────────────────────────────────────── */
export default function App() {
  const { dark, toggle } = useTheme();
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [onboarding, setOnboarding] = useState(
    !isOnboardingDone() && !getCredentials() && IS_STATIC_DEMO,
  );

  return (
    <div className="min-h-full">
      {/* Sidebar (desktop) */}
      <div className="hidden md:block">
        <Sidebar
          onPalette={() => setPalette(true)}
          onSettings={() => setSettings(true)}
          dark={dark}
          toggle={toggle}
        />
      </div>

      {/* Mobile sidebar drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-56">
            <Sidebar
              onPalette={() => { setPalette(true); setMobileOpen(false); }}
              onSettings={() => { setSettings(true); setMobileOpen(false); }}
              dark={dark}
              toggle={toggle}
            />
          </div>
        </div>
      )}

      {/* Mobile top bar */}
      <MobileBar onMenu={() => setMobileOpen(true)} dark={dark} />

      {/* Main content — offset by sidebar on desktop */}
      <div className="md:pl-56 min-h-screen">
        <main className="mx-auto max-w-[1400px] px-5 py-7">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/new" element={<NewSession />} />
            <Route path="/s/:id" element={<Session />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </main>
        <footer className="px-5 py-5 text-xs text-zinc-700 border-t border-white/[0.04]">
          Co-Scientist · multi-agent hypothesis generation · by Quang Bui
        </footer>
      </div>

      <CommandPalette open={palette} setOpen={setPalette} onToggleTheme={toggle} />
      <OnboardingModal
        open={onboarding}
        onClose={() => setOnboarding(false)}
      />
      <SettingsModal open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}

