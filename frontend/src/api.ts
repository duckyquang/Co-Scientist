import { apiUrl, IS_STATIC_DEMO, STATIC_DEMO_ROOT } from "./lib/config";
import { authHeaders } from "./lib/credentials";
import { canUseLiveApi, isSimulatedMode } from "./lib/live";
import * as sim from "./lib/sim/engine";
import type {
  ClusterPoint, CostByAgent, Feedback, GlobalStats, Hypothesis, LineageNode,
  Match, Meta, SessionDetail, SessionRow,
} from "./types";

/** One chat turn (user or assistant). Shape shared by sim/live/history. */
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  intent?: string | null;
  new_session_id?: string | null;
  created_at?: string;
}

export interface ChatReply {
  reply_markdown: string;
  intent: string;
  new_session_id?: string | null;
}

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || body.error || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

async function staticGet<T>(path: string): Promise<T> {
  const res = await fetch(`${STATIC_DEMO_ROOT}/${path}`);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

function useLiveOrStatic<T>(live: () => Promise<T>, staticPath: string): Promise<T> {
  if (canUseLiveApi() || !IS_STATIC_DEMO) return live();
  return staticGet<T>(staticPath);
}

/** Resolve a per-session read: in-browser simulation for sim_ ids, else the
 *  normal live-or-static path. Keeps every UI panel backend-agnostic. */
function sessionRead<T>(id: string, simFn: () => T, live: () => Promise<T>, staticPath: string): Promise<T> {
  if (sim.isSimSession(id)) return Promise.resolve().then(simFn);
  return useLiveOrStatic(live, staticPath);
}

export const api = {
  meta: () =>
    useLiveOrStatic(() => j<Meta>("/api/meta"), "meta.json"),

  stats: () =>
    useLiveOrStatic(() => j<GlobalStats>("/api/stats"), "stats.json").then((base: any) => {
      // Fold locally-simulated sessions into the dashboard totals.
      if (!isSimulatedMode()) return base;
      const s = sim.simStats();
      return {
        n_sessions: (base?.n_sessions || 0) + s.n_sessions,
        n_hypotheses: (base?.n_hypotheses || 0) + s.n_hypotheses,
        n_matches: (base?.n_matches || 0) + s.n_matches,
        total_cost_usd: (base?.total_cost_usd || 0) + s.total_cost_usd,
        running: (base?.running || 0) + s.running,
        done: (base?.done || 0) + s.done,
      } as GlobalStats;
    }),

  sessions: () =>
    useLiveOrStatic(
      () => j<{ sessions: SessionRow[] }>("/api/sessions").then((d) => d.sessions),
      "sessions.json",
    )
      .then((d: any) => (Array.isArray(d) ? d : d.sessions))
      // Prepend live in-browser sessions so they show up on the dashboard/sidebar.
      .then((rows: SessionRow[]) => (isSimulatedMode() ? [...sim.simListSessions(), ...rows] : rows)),

  session: (id: string) =>
    sessionRead(id, () => sim.simDetail(id),
      () => j<SessionDetail>(`/api/sessions/${id}`),
      `sessions/${id}/detail.json`),

  hypotheses: (id: string) =>
    sessionRead(id, () => sim.simHypotheses(id),
      () => j<{ hypotheses: Hypothesis[] }>(`/api/sessions/${id}/hypotheses`).then((d) => d.hypotheses),
      `sessions/${id}/hypotheses.json`,
    ).then((d: any) => (Array.isArray(d) ? d : d.hypotheses)),

  hypothesis: (id: string, hid: string) =>
    sessionRead(id, () => sim.simHypothesis(id, hid),
      () => j<Hypothesis>(`/api/sessions/${id}/hypotheses/${hid}`),
      `sessions/${id}/hypotheses/${hid}.json`),

  matches: (id: string) =>
    sessionRead(id, () => sim.simMatches(id),
      () => j<{ matches: Match[] }>(`/api/sessions/${id}/matches`).then((d) => d.matches),
      `sessions/${id}/matches.json`,
    ).then((d: any) => (Array.isArray(d) ? d : d.matches)),

  cost: (id: string) =>
    sessionRead(id, () => sim.simCost(id),
      () => j<{ by_agent: CostByAgent[]; summary: any }>(`/api/sessions/${id}/cost`),
      `sessions/${id}/cost.json`),

  feedback: (id: string) =>
    sessionRead(id, () => sim.simFeedback(id),
      () => j<{ feedback: Feedback[] }>(`/api/sessions/${id}/feedback`).then((d) => d.feedback),
      `sessions/${id}/feedback.json`,
    ).then((d: any) => (Array.isArray(d) ? d : d.feedback)),

  lineage: (id: string) =>
    sessionRead(id, () => sim.simLineage(id),
      () => j<{ nodes: LineageNode[]; edges: { source: string; target: string }[] }>(
        `/api/sessions/${id}/lineage`,
      ),
      `sessions/${id}/lineage.json`),

  clusters: (id: string) =>
    sessionRead(id, () => sim.simClusters(id),
      () => j<{ points: ClusterPoint[] }>(`/api/sessions/${id}/clusters`).then((d) => d.points),
      `sessions/${id}/clusters.json`,
    ).then((d: any) => (Array.isArray(d) ? d : d.points)),

  eloHistory: (id: string) =>
    sessionRead(id, () => sim.simEloHistory(id),
      () => j<{ series: Record<string, { i: number; elo: number }[]> }>(
        `/api/sessions/${id}/elo-history`,
      ).then((d) => d.series),
      `sessions/${id}/elo-history.json`,
    ).then((d: any) => (d.series ? d.series : d)),

  overview: (id: string) =>
    sessionRead(id, () => sim.simOverview(id),
      () => j<{ markdown: string }>(`/api/sessions/${id}/overview`).then((d) => d.markdown),
      `sessions/${id}/overview.json`,
    ).then((d: any) => (typeof d === "string" ? d : d.markdown)),

  create: (body: {
    goal: string; budget_tokens: number; wall_clock_seconds: number;
    n_initial: number; provider?: string; speed?: number;
  }) => {
    // No backend? Run the session entirely in the browser — free, no key.
    if (isSimulatedMode()) {
      const session_id = sim.createSimSession(body);
      return Promise.resolve({ session_id });
    }
    return j<{ session_id: string }>("/api/sessions", {
      method: "POST", body: JSON.stringify(body),
    });
  },

  control: (id: string, action: "pause" | "resume" | "abort") => {
    if (sim.isSimSession(id)) return Promise.resolve(sim.simControl(id, action));
    return j<{ status: string }>(`/api/sessions/${id}/${action}`, { method: "POST" });
  },

  sendFeedback: (id: string, body: { text: string; kind?: string; target_id?: string }) => {
    if (sim.isSimSession(id)) return Promise.resolve(sim.simSendFeedback(id, body));
    return j<{ ok: boolean }>(`/api/sessions/${id}/feedback`, {
      method: "POST", body: JSON.stringify(body),
    });
  },

  chat: (id: string, message: string) => {
    if (sim.isSimSession(id)) return Promise.resolve(sim.simChat(id, message));
    return j<ChatReply>(`/api/sessions/${id}/chat`, {
      method: "POST", body: JSON.stringify({ message }),
    });
  },

  chatHistory: (id: string): Promise<ChatTurn[]> => {
    if (sim.isSimSession(id)) return Promise.resolve(sim.simChatHistory(id));
    return j<{ messages: ChatTurn[] }>(`/api/sessions/${id}/chat`).then((d) => d.messages);
  },

  setHypState: (id: string, hid: string, state: string) => {
    if (sim.isSimSession(id)) return Promise.resolve(sim.simSetHypState(id, hid, state));
    return j<{ ok: boolean }>(`/api/sessions/${id}/hypotheses/${hid}/state`, {
      method: "POST", body: JSON.stringify({ state }),
    });
  },
};

/** SSE stream URL for live session events. */
export function streamUrl(sessionId: string): string {
  return apiUrl(`/api/sessions/${sessionId}/stream`);
}
