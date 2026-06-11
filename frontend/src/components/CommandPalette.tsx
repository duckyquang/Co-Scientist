import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { SessionRow } from "../types";

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  icon: string;
  run: () => void;
}

export function CommandPalette({
  open, setOpen, onToggleTheme,
}: { open: boolean; setOpen: (b: boolean) => void; onToggleTheme: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      api.sessions().then(setSessions).catch(() => {});
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const cmds = useMemo<Cmd[]>(() => {
    const base: Cmd[] = [
      { id: "new", label: "Start new research session", icon: "✨", hint: "create", run: () => nav("/new") },
      { id: "home", label: "Go to dashboard", icon: "🏠", run: () => nav("/") },
      { id: "theme", label: "Toggle light / dark theme", icon: "🌓", run: onToggleTheme },
    ];
    const sess: Cmd[] = sessions.map((s) => ({
      id: s.id,
      label: s.research_goal,
      hint: `${s.status} · ${s.n_hyps} hyps`,
      icon: "🧪",
      run: () => nav(`/s/${s.id}`),
    }));
    return [...base, ...sess];
  }, [sessions, nav, onToggleTheme]);

  const filtered = cmds.filter((c) =>
    (c.label + (c.hint || "")).toLowerCase().includes(q.toLowerCase()),
  );

  const choose = (i: number) => {
    const c = filtered[i];
    if (c) {
      c.run();
      setOpen(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm pt-[12vh]"
      onClick={() => setOpen(false)}>
      <div className="card w-full max-w-xl overflow-hidden animate-fade-up" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="w-full border-b border-white/10 bg-transparent px-5 py-4 text-base text-slate-100 outline-none placeholder:text-slate-500"
          placeholder="Search sessions or run a command…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === "Enter") { e.preventDefault(); choose(active); }
          }}
        />
        <div className="max-h-[50vh] overflow-auto p-2">
          {filtered.length === 0 && <div className="px-3 py-6 text-center text-sm text-slate-500">No matches</div>}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition
                ${i === active ? "bg-brand-500/20 text-white" : "text-slate-300 hover:bg-white/5"}`}
            >
              <span className="text-base">{c.icon}</span>
              <span className="flex-1 truncate">{c.label}</span>
              {c.hint && <span className="text-[11px] text-slate-500">{c.hint}</span>}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-white/10 px-4 py-2 text-[11px] text-slate-500">
          <span><kbd className="rounded bg-white/10 px-1">↑↓</kbd> navigate</span>
          <span><kbd className="rounded bg-white/10 px-1">↵</kbd> open</span>
          <span><kbd className="rounded bg-white/10 px-1">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
