import { API_ROOT, IS_STATIC_DEMO } from "./lib/config";
import type {
  ClusterPoint, CostByAgent, Feedback, GlobalStats, Hypothesis, LineageNode,
  Match, Meta, SessionDetail, SessionRow,
} from "./types";

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).error || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

async function staticGet<T>(path: string): Promise<T> {
  return j<T>(`${API_ROOT}/${path}`);
}

function staticErr(msg: string): never {
  throw new Error(msg);
}

export const api = {
  meta: () =>
    IS_STATIC_DEMO
      ? staticGet<Meta>("meta.json")
      : j<Meta>("/api/meta"),

  stats: () =>
    IS_STATIC_DEMO
      ? staticGet<GlobalStats>("stats.json")
      : j<GlobalStats>("/api/stats"),

  sessions: () =>
    IS_STATIC_DEMO
      ? staticGet<{ sessions: SessionRow[] }>("sessions.json").then((d) => d.sessions)
      : j<{ sessions: SessionRow[] }>("/api/sessions").then((d) => d.sessions),

  session: (id: string) =>
    IS_STATIC_DEMO
      ? staticGet<SessionDetail>(`sessions/${id}/detail.json`)
      : j<SessionDetail>(`/api/sessions/${id}`),

  hypotheses: (id: string) =>
    IS_STATIC_DEMO
      ? staticGet<{ hypotheses: Hypothesis[] }>(`sessions/${id}/hypotheses.json`).then((d) => d.hypotheses)
      : j<{ hypotheses: Hypothesis[] }>(`/api/sessions/${id}/hypotheses`).then((d) => d.hypotheses),

  hypothesis: (id: string, hid: string) =>
    IS_STATIC_DEMO
      ? staticGet<Hypothesis>(`sessions/${id}/hypotheses/${hid}.json`)
      : j<Hypothesis>(`/api/sessions/${id}/hypotheses/${hid}`),

  matches: (id: string) =>
    IS_STATIC_DEMO
      ? staticGet<{ matches: Match[] }>(`sessions/${id}/matches.json`).then((d) => d.matches)
      : j<{ matches: Match[] }>(`/api/sessions/${id}/matches`).then((d) => d.matches),

  cost: (id: string) =>
    IS_STATIC_DEMO
      ? staticGet<{ by_agent: CostByAgent[]; summary: any }>(`sessions/${id}/cost.json`)
      : j<{ by_agent: CostByAgent[]; summary: any }>(`/api/sessions/${id}/cost`),

  feedback: (id: string) =>
    IS_STATIC_DEMO
      ? staticGet<{ feedback: Feedback[] }>(`sessions/${id}/feedback.json`).then((d) => d.feedback)
      : j<{ feedback: Feedback[] }>(`/api/sessions/${id}/feedback`).then((d) => d.feedback),

  lineage: (id: string) =>
    IS_STATIC_DEMO
      ? staticGet<{ nodes: LineageNode[]; edges: { source: string; target: string }[] }>(
          `sessions/${id}/lineage.json`,
        )
      : j<{ nodes: LineageNode[]; edges: { source: string; target: string }[] }>(
          `/api/sessions/${id}/lineage`,
        ),

  clusters: (id: string) =>
    IS_STATIC_DEMO
      ? staticGet<{ points: ClusterPoint[] }>(`sessions/${id}/clusters.json`).then((d) => d.points)
      : j<{ points: ClusterPoint[] }>(`/api/sessions/${id}/clusters`).then((d) => d.points),

  eloHistory: (id: string) =>
    IS_STATIC_DEMO
      ? staticGet<{ series: Record<string, { i: number; elo: number }[]> }>(
          `sessions/${id}/elo-history.json`,
        ).then((d) => d.series)
      : j<{ series: Record<string, { i: number; elo: number }[]> }>(
          `/api/sessions/${id}/elo-history`,
        ).then((d) => d.series),

  overview: (id: string) =>
    IS_STATIC_DEMO
      ? staticGet<{ markdown: string }>(`sessions/${id}/overview.json`).then((d) => d.markdown)
      : j<{ markdown: string }>(`/api/sessions/${id}/overview`).then((d) => d.markdown),

  create: (body: {
    goal: string; budget_usd: number; n_initial: number; provider?: string; speed?: number;
  }) =>
    IS_STATIC_DEMO
      ? staticErr("Static demo — browse existing sessions or run locally to create new ones.")
      : j<{ session_id: string }>("/api/sessions", { method: "POST", body: JSON.stringify(body) }),

  control: (id: string, action: "pause" | "resume" | "abort") =>
    IS_STATIC_DEMO
      ? Promise.resolve({ status: action === "pause" ? "paused" : action === "resume" ? "running" : "aborted" })
      : j<{ status: string }>(`/api/sessions/${id}/${action}`, { method: "POST" }),

  sendFeedback: (id: string, body: { text: string; kind?: string; target_id?: string }) =>
    IS_STATIC_DEMO
      ? Promise.resolve({ ok: true })
      : j<{ ok: boolean }>(`/api/sessions/${id}/feedback`, {
          method: "POST", body: JSON.stringify(body),
        }),

  setHypState: (id: string, hid: string, state: string) =>
    IS_STATIC_DEMO
      ? Promise.resolve({ ok: true })
      : j<{ ok: boolean }>(`/api/sessions/${id}/hypotheses/${hid}/state`, {
          method: "POST", body: JSON.stringify({ state }),
        }),
};
