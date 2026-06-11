import { useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { CommandPalette } from "./components/CommandPalette";
import { OnboardingModal } from "./components/OnboardingModal";
import { SettingsModal } from "./components/SettingsModal";
import { IS_LOCAL_HOST, IS_STATIC_DEMO } from "./lib/config";
import { getDeploymentMode, isOnboardingDone } from "./lib/credentials";
import { canUseLiveApi } from "./lib/live";
import { useTheme } from "./lib/hooks";
import Dashboard from "./pages/Dashboard";
import NewSession from "./pages/NewSession";
import Session from "./pages/Session";

function ModeBadge() {
  if (IS_LOCAL_HOST && !IS_STATIC_DEMO) {
    return (
      <span className="hidden rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400 sm:inline">
        Local
      </span>
    );
  }
  if (canUseLiveApi()) {
    return (
      <span className="hidden rounded-md bg-flux-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-flux-300 sm:inline">
        Cloud
      </span>
    );
  }
  if (getDeploymentMode() === "local") {
    return (
      <span className="hidden rounded-md bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-300 sm:inline">
        Local setup
      </span>
    );
  }
  return (
    <span className="hidden rounded-md bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:inline">
      Demo
    </span>
  );
}

function TopBar({
  onPalette, onSettings, dark, toggle,
}: {
  onPalette: () => void;
  onSettings: () => void;
  dark: boolean;
  toggle: () => void;
}) {
  const loc = useLocation();
  const linkCls = (to: string) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      loc.pathname === to ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"
    }`;
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-4 px-5">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-flux-500 text-lg shadow-glow">🧬</span>
          <span className="text-[15px] font-bold tracking-tight text-white">Co-Scientist</span>
          <ModeBadge />
        </Link>
        <nav className="ml-2 hidden items-center gap-1 md:flex">
          <NavLink to="/" className={linkCls("/")}>Dashboard</NavLink>
          <NavLink to="/new" className={linkCls("/new")}>New session</NavLink>
        </nav>
        <div className="flex-1" />
        <button onClick={onSettings}
          className="hidden rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 sm:inline-flex">
          ⚙️ Settings
        </button>
        <button onClick={onPalette}
          className="hidden items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 sm:flex">
          <span>Search</span>
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
        </button>
        <button onClick={toggle} title="Toggle theme"
          className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-slate-300 hover:text-white">
          {dark ? "☀️" : "🌙"}
        </button>
        <Link to="/new" className="btn-primary hidden h-9 sm:inline-flex">+ New</Link>
      </div>
    </header>
  );
}

export default function App() {
  const { dark, toggle } = useTheme();
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState(false);
  const [onboarding, setOnboarding] = useState(
    IS_STATIC_DEMO && !isOnboardingDone(),
  );

  return (
    <div className="min-h-full">
      <TopBar
        onPalette={() => setPalette(true)}
        onSettings={() => setSettings(true)}
        dark={dark}
        toggle={toggle}
      />
      <main className="mx-auto max-w-[1500px] px-5 py-7">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new" element={<NewSession onOpenSettings={() => setSettings(true)} />} />
          <Route path="/s/:id" element={<Session />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </main>
      <CommandPalette open={palette} setOpen={setPalette} onToggleTheme={toggle} />
      <OnboardingModal
        open={onboarding}
        onClose={() => setOnboarding(false)}
        onCloud={() => setSettings(true)}
      />
      <SettingsModal open={settings} onClose={() => setSettings(false)} />
      <footer className="border-t border-white/[0.05] py-6 text-center text-xs text-slate-600">
        Co-Scientist · multi-agent hypothesis generation · created by Quang Bui
      </footer>
    </div>
  );
}
