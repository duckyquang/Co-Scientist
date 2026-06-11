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

// agent -> color identity (used across timeline, costs, badges)
export const AGENT_COLORS: Record<string, { hex: string; bg: string; text: string }> = {
  generation: { hex: "#6366f1", bg: "bg-brand-500/15", text: "text-brand-300" },
  reflection: { hex: "#22d3ee", bg: "bg-cyber-500/15", text: "text-cyber-400" },
  ranking: { hex: "#f59e0b", bg: "bg-amber-500/15", text: "text-amber-400" },
  evolution: { hex: "#a855f7", bg: "bg-flux-500/15", text: "text-flux-400" },
  proximity: { hex: "#10b981", bg: "bg-emerald-500/15", text: "text-emerald-400" },
  metareview: { hex: "#ec4899", bg: "bg-pink-500/15", text: "text-pink-400" },
  supervisor: { hex: "#94a3b8", bg: "bg-slate-500/15", text: "text-slate-300" },
  human: { hex: "#34d399", bg: "bg-emerald-500/15", text: "text-emerald-300" },
};

export const agentColor = (a: string | null | undefined) =>
  AGENT_COLORS[a || "supervisor"] || AGENT_COLORS.supervisor;

export const STATUS_STYLE: Record<string, string> = {
  running: "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30",
  paused: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30",
  done: "bg-brand-500/15 text-brand-300 ring-1 ring-brand-500/30",
  failed: "bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30",
  aborted: "bg-slate-500/15 text-slate-400 ring-1 ring-slate-500/30",
};

export const HYP_STATE_STYLE: Record<string, string> = {
  pinned: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
  in_tournament: "bg-brand-500/15 text-brand-300 ring-1 ring-brand-500/30",
  reviewed: "bg-cyber-500/15 text-cyber-400 ring-1 ring-cyber-500/30",
  draft: "bg-slate-500/15 text-slate-400 ring-1 ring-slate-500/30",
  rejected: "bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30",
  retired: "bg-slate-500/10 text-slate-500 ring-1 ring-slate-500/20",
  quarantined: "bg-orange-500/15 text-orange-400 ring-1 ring-orange-500/30",
};

export const STRATEGY_ICON: Record<string, string> = {
  literature: "📚",
  debate: "⚔️",
  combine: "🧬",
  simplify: "✂️",
  out_of_box: "💡",
  feasibility: "🔧",
  assumption: "🔍",
  feedback_driven: "🎯",
};

export const eloColor = (elo: number | null | undefined) => {
  if (elo == null) return "text-slate-500";
  if (elo >= 1260) return "text-amber-300";
  if (elo >= 1220) return "text-emerald-400";
  if (elo >= 1180) return "text-slate-200";
  return "text-rose-400";
};
