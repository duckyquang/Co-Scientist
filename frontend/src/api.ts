import { apiUrl, IS_STATIC_DEMO, STATIC_DEMO_ROOT } from "./lib/config";
import { authHeaders } from "./lib/credentials";
import { canUseLiveApi } from "./lib/live";
import type {
  ClusterPoint, CostByAgent, Feedback, GlobalStats, Hypothesis, LineageNode,
  Match, Meta, SessionDetail, SessionRow,
} from "./types";

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

function needsCloudSetup(): never {
  throw new Error(
    "Cloud mode requires an API key. Open Settings, add your key, and ensure the hosted API is configured.",
  );
}

function useLiveOrStatic<T>(live: () => Promise<T>, staticPath: string): Promise<T> {
  if (canUseLiveApi() || !IS_STATIC_DEMO) return live();
  return staticGet<T>(staticPath);
}

export const api = {
  meta: () =>
    useLiveOrStatic(() => j<Meta>("/api/meta"), "meta.json"),

  stats: () =>
    useLiveOrStatic(() => j<GlobalStats>("/api/stats"), "stats.json"),

  sessions: () =>
    useLiveOrStatic(
      () => j<{ sessions: SessionRow[] }>("/api/sessions").then((d) => d.sessions),
      "sessions.json",
    ).then((d: any) => (Array.isArray(d) ? d : d.sessions)),

  session: (id: string) =>
    useLiveOrStatic(
      () => j<SessionDetail>(`/api/sessions/${id}`),
      `sessions/${id}/detail.json`,
    ),

  hypotheses: (id: string) =>
    useLiveOrStatic(
      () => j<{ hypotheses: Hypothesis[] }>(`/api/sessions/${id}/hypotheses`).then((d) => d.hypotheses),
      `sessions/${id}/hypotheses.json`,
    ).then((d: any) => (Array.isArray(d) ? d : d.hypotheses)),

  hypothesis: (id: string, hid: string) =>
    useLiveOrStatic(
      () => j<Hypothesis>(`/api/sessions/${id}/hypotheses/${hid}`),
      `sessions/${id}/hypotheses/${hid}.json`,
    ),

  matches: (id: string) =>
    useLiveOrStatic(
      () => j<{ matches: Match[] }>(`/api/sessions/${id}/matches`).then((d) => d.matches),
      `sessions/${id}/matches.json`,
    ).then((d: any) => (Array.isArray(d) ? d : d.matches)),

  cost: (id: string) =>
    useLiveOrStatic(
      () => j<{ by_agent: CostByAgent[]; summary: any }>(`/api/sessions/${id}/cost`),
      `sessions/${id}/cost.json`,
    ),

  feedback: (id: string) =>
    useLiveOrStatic(
      () => j<{ feedback: Feedback[] }>(`/api/sessions/${id}/feedback`).then((d) => d.feedback),
      `sessions/${id}/feedback.json`,
    ).then((d: any) => (Array.isArray(d) ? d : d.feedback)),

  lineage: (id: string) =>
    useLiveOrStatic(
      () => j<{ nodes: LineageNode[]; edges: { source: string; target: string }[] }>(
        `/api/sessions/${id}/lineage`,
      ),
      `sessions/${id}/lineage.json`,
    ),

  clusters: (id: string) =>
    useLiveOrStatic(
      () => j<{ points: ClusterPoint[] }>(`/api/sessions/${id}/clusters`).then((d) => d.points),
      `sessions/${id}/clusters.json`,
    ).then((d: any) => (Array.isArray(d) ? d : d.points)),

  eloHistory: (id: string) =>
    useLiveOrStatic(
      () => j<{ series: Record<string, { i: number; elo: number }[]> }>(
        `/api/sessions/${id}/elo-history`,
      ).then((d) => d.series),
      `sessions/${id}/elo-history.json`,
    ).then((d: any) => (d.series ? d.series : d)),

  overview: (id: string) =>
    useLiveOrStatic(
      () => j<{ markdown: string }>(`/api/sessions/${id}/overview`).then((d) => d.markdown),
      `sessions/${id}/overview.json`,
    ).then((d: any) => (typeof d === "string" ? d : d.markdown)),

  create: (body: {
    goal: string; budget_usd: number; n_initial: number; provider?: string; speed?: number;
  }) => {
    if (IS_STATIC_DEMO && !canUseLiveApi()) return Promise.reject(needsCloudSetup());
    return j<{ session_id: string }>("/api/sessions", {
      method: "POST", body: JSON.stringify(body),
    });
  },

  control: (id: string, action: "pause" | "resume" | "abort") => {
    if (IS_STATIC_DEMO && !canUseLiveApi()) {
      return Promise.resolve({
        status: action === "pause" ? "paused" : action === "resume" ? "running" : "aborted",
      });
    }
    return j<{ status: string }>(`/api/sessions/${id}/${action}`, { method: "POST" });
  },

  sendFeedback: (id: string, body: { text: string; kind?: string; target_id?: string }) => {
    if (IS_STATIC_DEMO && !canUseLiveApi()) return Promise.resolve({ ok: true });
    return j<{ ok: boolean }>(`/api/sessions/${id}/feedback`, {
      method: "POST", body: JSON.stringify(body),
    });
  },

  setHypState: (id: string, hid: string, state: string) => {
    if (IS_STATIC_DEMO && !canUseLiveApi()) return Promise.resolve({ ok: true });
    return j<{ ok: boolean }>(`/api/sessions/${id}/hypotheses/${hid}/state`, {
      method: "POST", body: JSON.stringify({ state }),
    });
  },
};

/** SSE stream URL for live session events. */
export function streamUrl(sessionId: string): string {
  return apiUrl(`/api/sessions/${sessionId}/stream`);
}
