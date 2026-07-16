import { useEffect, useRef, useState, useCallback } from "react";
import { IS_STATIC_DEMO, STATIC_DEMO_ROOT } from "./config";
import { streamUrl } from "../api";
import { canUseLiveApi } from "./live";
import { isSimSession, simEvents, simTick } from "./sim/engine";
import type { SSEvent } from "../types";

const KNOWN_EVENTS = [
  "session_started", "task_started", "task_completed", "task_failed",
  "hypothesis_created", "review_completed", "match_complete",
  "tournament_match_complete", "session_done", "human_feedback",
  "session_paused", "session_resumed", "session_aborted",
  "hypothesis_state_changed",
];

export interface LiveTick {
  metrics: any;
  status: string;
  budget_used_usd: number;
  live: boolean;
}

/** Subscribe to a session's SSE stream. Returns the rolling event log + last tick. */
export function useSessionStream(sessionId: string | undefined) {
  const [events, setEvents] = useState<SSEvent[]>([]);
  const [tick, setTick] = useState<LiveTick | null>(null);
  const [connected, setConnected] = useState(false);
  const seen = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!sessionId) return;
    seen.current = new Set();
    setEvents([]);

    // In-browser simulated session: poll the engine to animate the feed/gauges.
    if (isSimSession(sessionId)) {
      let iv: ReturnType<typeof setInterval> | undefined;
      // Returns false once the session is terminal (done/aborted) — paused is
      // NOT terminal, so polling continues and Resume re-animates seamlessly.
      const poll = (): boolean => {
        try {
          setEvents(simEvents(sessionId).slice(-300).reverse());
          const t = simTick(sessionId);
          setTick(t);
          setConnected(t.live); // true only while running; paused/done → idle
          return t.status !== "done" && t.status !== "aborted";
        } catch { setConnected(false); return false; }
      };
      // Only start the interval if the first snapshot isn't already terminal —
      // otherwise a completed session opened on refresh would poll forever.
      if (poll()) iv = setInterval(() => { if (!poll()) clearInterval(iv); }, 1100);
      return () => clearInterval(iv);
    }

    if (IS_STATIC_DEMO && !canUseLiveApi()) {
      fetch(`${STATIC_DEMO_ROOT}/sessions/${sessionId}/events.json`)
        .then((r) => r.json())
        .then((d) => {
          const evs = (d.events || []).map((ev: SSEvent) => ({ ...ev, event: ev.event || "event" }));
          setEvents(evs.slice(0, 300).reverse());
        })
        .catch(() => {});
      setConnected(false);
      return;
    }

    const es = new EventSource(streamUrl(sessionId));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    const onEvt = (name: string) => (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        if (d.id != null) {
          if (seen.current.has(d.id)) return;
          seen.current.add(d.id);
        }
        setEvents((prev) => [{ ...d, event: name } as SSEvent, ...prev].slice(0, 300));
      } catch {}
    };
    KNOWN_EVENTS.forEach((name) => es.addEventListener(name, onEvt(name)));
    es.addEventListener("tick", (e: MessageEvent) => {
      try { setTick(JSON.parse(e.data)); } catch {}
    });
    return () => es.close();
  }, [sessionId]);

  return { events, tick, connected };
}

/** Generic polling for non-live data. */
export function usePoll<T>(
  fn: () => Promise<T>,
  deps: any[],
  intervalMs: number | null,
): { data: T | null; error: string | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    try {
      const d = await fnRef.current();
      setData(d);
      setError(null);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
    if (intervalMs) {
      const t = setInterval(run, intervalMs);
      return () => clearInterval(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalMs]);

  return { data, error, loading, refresh: run };
}

/* ── Stick-to-bottom (chat thread) ─────────────────────────────
   Auto-scrolls a container to the bottom when new content arrives, but ONLY
   when the user is already near the bottom — so reading history is never
   yanked down. `dep` should change whenever content grows (e.g. message count). */
export function useStickToBottom(dep: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);

  return { scrollRef, onScroll };
}

/* ── Theme (light / dark) ──────────────────────────────────── */
export type Theme = "light" | "dark";
const THEME_KEY = "cosci_theme";

/** Resolve the active theme: explicit user choice, else the dark default. */
export function getTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* ignore */ }
  return "dark";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/** Apply the saved/system theme on first load (call once, before render). */
export function initTheme() {
  applyTheme(getTheme());
}

/** Reactive theme state + setter, synced to <html> and localStorage. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
  }, []);
  return [theme, setTheme];
}

/* ── Scroll reveal ─────────────────────────────────────────── */
/** Adds `is-in` once the element scrolls into view, then disconnects.
 *  Usage: <div ref={useReveal<HTMLDivElement>()} className="reveal"> */
export function useReveal<T extends HTMLElement>() {
  return useCallback((el: T | null) => {
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.classList.add("is-in");
          io.disconnect();
        }
      },
      { threshold: 0.08 },
    );
    io.observe(el);
  }, []);
}
