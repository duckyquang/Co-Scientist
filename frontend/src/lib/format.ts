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

import type { LucideIcon } from "lucide-react";
import {
  BookOpen, Swords, GitMerge, Scissors, Lightbulb, Wrench, Search, Target,
  Sparkles, Microscope, GitBranch, Network, ClipboardList, Cpu, User,
  Rocket, Play, Pause, Check, TriangleAlert, MessageSquare, Pin, Flag, Ban,
  Dot,
} from "lucide-react";

// ── Agent colors — blue mono palette (theme-aware text) ────
export const AGENT_COLORS: Record<string, { hex: string; bg: string; text: string }> = {
  generation: { hex: "#3b82f6", bg: "bg-blue-500/15", text: "text-blue-600 dark:text-blue-400" },
  reflection:  { hex: "#60a5fa", bg: "bg-blue-400/15", text: "text-blue-600 dark:text-blue-300" },
  ranking:     { hex: "#93c5fd", bg: "bg-blue-300/15", text: "text-blue-600 dark:text-blue-200" },
  evolution:   { hex: "#1d4ed8", bg: "bg-blue-700/15", text: "text-blue-700 dark:text-blue-400" },
  proximity:   { hex: "#2563eb", bg: "bg-blue-600/15", text: "text-blue-600 dark:text-blue-400" },
  metareview:  { hex: "#3b82f6", bg: "bg-blue-200/20 dark:bg-blue-200/10", text: "text-blue-600 dark:text-blue-200" },
  supervisor:  { hex: "#71717a", bg: "bg-surface-2", text: "text-muted" },
  human:       { hex: "#52525b", bg: "bg-surface-2", text: "text-fg" },
};

export const agentColor = (a: string | null | undefined) =>
  AGENT_COLORS[a || "supervisor"] || AGENT_COLORS.supervisor;

// ── Session status — theme-aware ───────────────────────────
export const STATUS_STYLE: Record<string, string> = {
  running: "bg-brand-500/10 text-brand-600 dark:text-brand-400 ring-1 ring-brand-500/25",
  paused:  "bg-surface-2 text-muted ring-1 ring-line",
  done:    "bg-surface-2 text-fg ring-1 ring-line",
  failed:  "bg-surface-2 text-faint ring-1 ring-line",
  aborted: "bg-surface-2 text-faint ring-1 ring-line",
};

// ── Hypothesis state — theme-aware ─────────────────────────
export const HYP_STATE_STYLE: Record<string, string> = {
  pinned:        "bg-brand-500/10 text-brand-600 dark:text-brand-300 ring-1 ring-brand-500/20",
  in_tournament: "bg-brand-600/10 text-brand-600 dark:text-brand-400 ring-1 ring-brand-600/20",
  reviewed:      "bg-surface-2 text-muted ring-1 ring-line",
  draft:         "bg-surface-2 text-faint ring-1 ring-line",
  rejected:      "bg-surface-2 text-faint ring-1 ring-line",
  retired:       "bg-surface-2 text-faint ring-1 ring-line",
  quarantined:   "bg-surface-2 text-faint ring-1 ring-line",
};

// ── Strategy icons (lucide components) ─────────────────────
export const STRATEGY_ICON: Record<string, LucideIcon> = {
  literature:      BookOpen,
  debate:          Swords,
  combine:         GitMerge,
  simplify:        Scissors,
  out_of_box:      Lightbulb,
  feasibility:     Wrench,
  assumption:      Search,
  feedback_driven: Target,
};
export const strategyIcon = (s: string): LucideIcon => STRATEGY_ICON[s] || Dot;

// ── Agent icons (lucide components) ────────────────────────
export const AGENT_ICON: Record<string, LucideIcon> = {
  generation: Sparkles,
  reflection: Microscope,
  ranking:    Swords,
  evolution:  GitBranch,
  proximity:  Network,
  metareview: ClipboardList,
  supervisor: Cpu,
  human:      User,
};
export const agentIcon = (a: string | null | undefined): LucideIcon =>
  AGENT_ICON[a || "supervisor"] || Cpu;

// ── Activity-event icons (lucide components) ───────────────
export const EVENT_ICON: Record<string, LucideIcon> = {
  session_started: Rocket,
  hypothesis_created: Lightbulb,
  review_completed: Microscope,
  match_complete: Swords,
  task_started: Play,
  task_completed: Check,
  task_failed: TriangleAlert,
  human_feedback: MessageSquare,
  hypothesis_state_changed: Pin,
  session_done: Flag,
  session_paused: Pause,
  session_running: Play,
  session_aborted: Ban,
};

// ── Elo color — theme-aware ────────────────────────────────
export const eloColor = (elo: number | null | undefined) => {
  if (elo == null)   return "text-faint";
  if (elo >= 1260)   return "text-fg";
  if (elo >= 1220)   return "text-brand-600 dark:text-brand-400";
  if (elo >= 1180)   return "text-muted";
  return "text-faint";
};
