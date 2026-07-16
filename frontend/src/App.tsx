import { useState } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  LayoutGrid, Plus, Search, Settings, Menu, Sun, Moon,
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
import Chat from "./pages/Chat";
import Microsite from "./pages/Microsite";
import Landing from "./pages/Landing";
import { timeAgo } from "./lib/format";
import type { SessionRow } from "./types";

/* ── Mode badge ─────────────────────────────────────────── */
function ModeBadge() {
  if (IS_LOCAL_HOST && !IS_STATIC_DEMO)
    return <span className="chip chip-blue">Local</span>;
  if (canUseLiveApi())
    return <span className="chip chip-blue">Cloud</span>;
  if (getDeploymentMode() === "byok" && getCredentials())
    return <span className="chip chip-blue">Your key</span>;
  return <span className="chip chip-mute">Free</span>;
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
  const recent = (sessions || []).filter((s) => !s.id.startsWith("demo::")).slice(0, 30);

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r border-rule bg-paper no-print">
      {/* Masthead */}
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-rule px-4">
        <Link to="/" className="min-w-0 truncate font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-ink">
          Co-Scientist
        </Link>
        <ModeBadge />
      </div>

      {/* Primary nav */}
      <div className="px-3 pt-3 pb-2 space-y-0.5">
        <Link to="/chat" className="nav-item">
          <Plus className="h-4 w-4 shrink-0" strokeWidth={2.5} />
          New session
        </Link>
        <SLink to="/sessions">
          <LayoutGrid className="h-4 w-4 shrink-0" />
          All sessions
        </SLink>
      </div>

      {/* Conversation history */}
      {recent.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3">
          <div className="label mb-2 px-2.5">Chats</div>
          <div className="space-y-0.5">
            {recent.map((s) => (
              <SLink key={s.id} to={`/s/${s.id}`}>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  s.status === "running" ? "bg-blue animate-pulseDot" :
                  s.status === "done"    ? "bg-green" :
                  s.status === "paused"  ? "bg-ink-soft" : "bg-rule"
                }`} />
                <span className="min-w-0 flex-1 truncate text-[12.5px]">
                  {s.research_goal.length > 30 ? s.research_goal.slice(0, 30) + "…" : s.research_goal}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-ink-soft">{timeAgo(s.updated_at)}</span>
              </SLink>
            ))}
          </div>
        </div>
      )}

      {!recent.length && <div className="flex-1" />}

      {/* Bottom utilities */}
      <div className="px-3 pb-4 pt-2 border-t border-rule space-y-0.5 mt-2">
        <button onClick={onPalette} className="nav-item w-full text-left">
          <Search className="h-4 w-4 shrink-0" />
          Search
          <kbd className="ml-auto border border-rule px-1.5 py-0.5 font-mono text-[10px] text-ink-soft">⌘K</kbd>
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
    <div className="sticky top-0 z-40 flex h-12 items-center gap-3 border-b border-rule bg-paper px-4 md:hidden no-print">
      <button onClick={onMenu} className="p-1 text-ink-soft hover:text-ink">
        <Menu className="h-5 w-5" />
      </button>
      <Link to="/" className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-ink">
        Co-Scientist
      </Link>
      <div className="ml-auto">
        <Link to="/chat" className="btn-primary h-8 px-3">+ New</Link>
      </div>
    </div>
  );
}

/* ── All-sessions grid (kept, its own scroll) ─────────────── */
function DashboardScroll() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-5 py-7">
        <Dashboard />
      </div>
    </div>
  );
}

/* ── Root ───────────────────────────────────────────────── */
export default function App() {
  const { pathname } = useLocation();
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [onboarding, setOnboarding] = useState(
    !isOnboardingDone() && !getCredentials() && IS_STATIC_DEMO,
  );

  // The marketing landing owns "/" and renders chrome-less (no sidebar/mobile bar).
  if (pathname === "/") return <Landing />;

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
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-56">
            <Sidebar
              onPalette={() => { setPalette(true); setMobileOpen(false); }}
              onSettings={() => { setSettings(true); setMobileOpen(false); }}
            />
          </div>
        </div>
      )}

      {/* Main content — fixed viewport height so the chat composer can dock */}
      <div className="flex h-dvh flex-col overflow-hidden md:pl-56 print:pl-0">
        <MobileBar onMenu={() => setMobileOpen(true)} />
        <main className="min-h-0 flex-1">
          <Routes>
            <Route path="/chat" element={<Chat />} />
            <Route path="/s/:id/site" element={<Microsite />} />
            <Route path="/s/:id" element={<Chat />} />
            <Route path="/sessions" element={<DashboardScroll />} />
            <Route path="/new" element={<Navigate to="/chat" replace />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </main>
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
