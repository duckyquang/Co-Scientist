import { useEffect, useRef, useState, useCallback } from "react";
import { IS_STATIC_DEMO, STATIC_DEMO_ROOT } from "./config";
import { streamUrl } from "../api";
import { canUseLiveApi } from "./live";
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

export function useTheme() {
  const [dark, setDark] = useState(() => {
    const s = localStorage.getItem("theme");
    return s ? s === "dark" : true;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}
