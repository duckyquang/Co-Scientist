import { useState } from "react";
import type { ReactNode } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import {
  FlaskConical, LayoutDashboard, Plus, Search, Settings, Menu, Sun, Moon,
} from "lucide-react";
import { CommandPalette } from "./components/CommandPalette";
import { OnboardingModal } from "./components/OnboardingModal";
import { SettingsModal } from "./components/SettingsModal";
import { IS_LOCAL_HOST, IS_STATIC_DEMO } from "./lib/config";
import { getCredentials, getDeploymentMode, isOnboardingDone } from "./lib/credentials";
import { canUseLiveApi } from "./lib/live";
import { usePoll, useTheme, initTheme } from "./lib/hooks";
import { api } from "./api";

// Apply the saved / system theme before first paint.
initTheme();
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
  return <span className="badge-pill bg-surface-2 text-faint">Demo</span>;
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
  onPalette, onSettings,
}: {
  onPalette: () => void;
  onSettings: () => void;
}) {
  const { data: sessions } = usePoll<SessionRow[]>(() => api.sessions(), [], 8000);
  const [theme, setTheme] = useTheme();
  // Only show real user sessions in the sidebar — never demo:: seeded ones
  const recent = (sessions || []).filter((s) => !s.id.startsWith("demo::")).slice(0, 6);

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 px-4">
        <Link to="/" className="flex items-center gap-2 min-w-0">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-600 shadow-glow">
            <FlaskConical className="h-4 w-4 text-white" />
          </span>
          <span className="text-[14px] font-bold text-fg truncate">Co-Scientist</span>
        </Link>
        <ModeBadge />
      </div>

      {/* Primary nav */}
      <div className="px-3 pt-1 pb-2 space-y-0.5">
        <SLink to="/" exact>
          <LayoutDashboard className="h-4 w-4 shrink-0" />
          Dashboard
        </SLink>
        <Link to="/new" className="nav-item group">
          <span className="grid h-4 w-4 shrink-0 place-items-center rounded bg-brand-600/20 text-brand-500 group-hover:bg-brand-600/30">
            <Plus className="h-3 w-3" strokeWidth={2.5} />
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
      <div className="px-3 pb-4 pt-2 border-t border-line space-y-0.5 mt-2">
        <button onClick={onPalette} className="nav-item w-full text-left">
          <Search className="h-4 w-4 shrink-0" />
          Search
          <kbd className="ml-auto font-mono text-[10px] text-faint bg-surface-2 px-1.5 py-0.5 rounded">⌘K</kbd>
        </button>
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="nav-item w-full text-left"
        >
          {theme === "dark"
            ? <Sun className="h-4 w-4 shrink-0" />
            : <Moon className="h-4 w-4 shrink-0" />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
        <button onClick={onSettings} className="nav-item w-full text-left">
          <Settings className="h-4 w-4 shrink-0" />
          Settings
        </button>
      </div>
    </aside>
  );
}

/* ── Mobile top bar (hidden on md+) ───────────────────────── */
function MobileBar({
  onMenu,
}: { onMenu: () => void }) {
  return (
    <div className="sticky top-0 z-40 flex h-12 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-xl md:hidden">
      <button onClick={onMenu} className="p-1 text-muted hover:text-fg">
        <Menu className="h-5 w-5" />
      </button>
      <Link to="/" className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand-600">
          <FlaskConical className="h-3.5 w-3.5 text-white" />
        </span>
        <span className="text-sm font-bold text-fg">Co-Scientist</span>
      </Link>
      <div className="ml-auto">
        <Link to="/new" className="btn-primary h-8 text-xs px-3">+ New</Link>
      </div>
    </div>
  );
}

/* ── Root ───────────────────────────────────────────────── */
export default function App() {
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
            />
          </div>
        </div>
      )}

      {/* Mobile top bar */}
      <MobileBar onMenu={() => setMobileOpen(true)} />

      {/* Main content — offset by sidebar on desktop, always ≥ viewport tall */}
      <div className="flex min-h-screen flex-col md:pl-56">
        <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-5 py-7">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/new" element={<NewSession />} />
            <Route path="/s/:id" element={<Session />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </main>
        <footer className="px-5 py-5 text-xs text-faint border-t border-line">
          Co-Scientist · multi-agent hypothesis generation · by Quang Bui
        </footer>
      </div>

      <CommandPalette open={palette} setOpen={setPalette} />
      <OnboardingModal
        open={onboarding}
        onClose={() => setOnboarding(false)}
      />
      <SettingsModal open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}

