export const fmtUsd = (n: number | null | undefined) =>
  n == null ? "$0.00" : "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtNum = (n: number | null | undefined) =>
  n == null ? "0" : n.toLocaleString();

export const fmtCompact = (n: number | null | undefined) =>
  n == null ? "0" : Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);

export function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

export const clockTime = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour12: false });

// ── Agent colors — blue mono palette ───────────────────────
export const AGENT_COLORS: Record<string, { hex: string; bg: string; text: string }> = {
  generation: { hex: "#3b82f6", bg: "bg-blue-500/15", text: "text-blue-400" },
  reflection:  { hex: "#60a5fa", bg: "bg-blue-400/15", text: "text-blue-300" },
  ranking:     { hex: "#93c5fd", bg: "bg-blue-300/15", text: "text-blue-200" },
  evolution:   { hex: "#1d4ed8", bg: "bg-blue-700/15", text: "text-blue-400" },
  proximity:   { hex: "#2563eb", bg: "bg-blue-600/15", text: "text-blue-400" },
  metareview:  { hex: "#bfdbfe", bg: "bg-blue-200/10", text: "text-blue-200" },
  supervisor:  { hex: "#94a3b8", bg: "bg-zinc-500/15", text: "text-zinc-400" },
  human:       { hex: "#e2e8f0", bg: "bg-zinc-200/10", text: "text-zinc-200" },
};

export const agentColor = (a: string | null | undefined) =>
  AGENT_COLORS[a || "supervisor"] || AGENT_COLORS.supervisor;

// ── Session status — blue/white/zinc ───────────────────────
export const STATUS_STYLE: Record<string, string> = {
  running: "bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/25",
  paused:  "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20",
  done:    "bg-white/10    text-white     ring-1 ring-white/15",
  failed:  "bg-zinc-700/10 text-zinc-500 ring-1 ring-zinc-600/20",
  aborted: "bg-zinc-700/10 text-zinc-600 ring-1 ring-zinc-700/15",
};

// ── Hypothesis state — blue/zinc ───────────────────────────
export const HYP_STATE_STYLE: Record<string, string> = {
  pinned:        "bg-blue-500/10 text-blue-300 ring-1 ring-blue-500/20",
  in_tournament: "bg-blue-600/10 text-blue-400 ring-1 ring-blue-600/20",
  reviewed:      "bg-zinc-400/10 text-zinc-300 ring-1 ring-zinc-400/20",
  draft:         "bg-zinc-600/10 text-zinc-500 ring-1 ring-zinc-600/15",
  rejected:      "bg-zinc-700/10 text-zinc-600 ring-1 ring-zinc-700/20",
  retired:       "bg-zinc-800/10 text-zinc-700 ring-1 ring-zinc-800/15",
  quarantined:   "bg-zinc-500/10 text-zinc-500 ring-1 ring-zinc-500/20",
};

export const STRATEGY_ICON: Record<string, string> = {
  literature:      "📚",
  debate:          "⚔️",
  combine:         "🧬",
  simplify:        "✂️",
  out_of_box:      "💡",
  feasibility:     "🔧",
  assumption:      "🔍",
  feedback_driven: "🎯",
};

// ── Elo color — white/blue/zinc only ─────────────────────
export const eloColor = (elo: number | null | undefined) => {
  if (elo == null)   return "text-zinc-600";
  if (elo >= 1260)   return "text-white";
  if (elo >= 1220)   return "text-blue-400";
  if (elo >= 1180)   return "text-zinc-300";
  return "text-zinc-500";
};
