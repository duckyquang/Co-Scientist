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

/** Human duration from seconds, e.g. 90 → "1m 30s", 3600 → "60m". */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || sec <= 0) return "0s";
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

import type { LucideIcon } from "lucide-react";
import {
  BookOpen, Swords, GitMerge, Scissors, Lightbulb, Wrench, Search, Target,
  Sparkles, Microscope, GitBranch, Network, ClipboardList, Cpu, User,
  Rocket, Play, Pause, Check, TriangleAlert, MessageSquare, Pin, Flag, Ban,
  Dot,
} from "lucide-react";

// ── Agent colors — GEML chart vars; identity comes from a colored dot ──
export const AGENT_COLORS: Record<string, { hex: string; bg: string; text: string }> = {
  generation: { hex: "var(--chart-1)", bg: "chip-mute", text: "text-ink" },
  reflection:  { hex: "var(--chart-2)", bg: "chip-mute", text: "text-ink" },
  ranking:     { hex: "var(--chart-3)", bg: "chip-mute", text: "text-ink" },
  evolution:   { hex: "var(--chart-5)", bg: "chip-mute", text: "text-ink" },
  proximity:   { hex: "var(--chart-4)", bg: "chip-mute", text: "text-ink" },
  metareview:  { hex: "var(--chart-6)", bg: "chip-mute", text: "text-ink" },
  supervisor:  { hex: "var(--ink-soft)", bg: "chip-mute", text: "text-ink-soft" },
  human:       { hex: "var(--ink)", bg: "chip-mute", text: "text-ink" },
};

export const agentColor = (a: string | null | undefined) =>
  AGENT_COLORS[a || "supervisor"] || AGENT_COLORS.supervisor;

// ── Session status — blue=running, green=done, red=failed, mute=rest ──
export const STATUS_STYLE: Record<string, string> = {
  running: "chip-blue",
  paused:  "chip-mute",
  done:    "chip-green",
  failed:  "chip-red",
  aborted: "chip-mute",
};

// ── Hypothesis state ───────────────────────────────────────
export const HYP_STATE_STYLE: Record<string, string> = {
  pinned:        "chip-green",
  in_tournament: "chip-blue",
  reviewed:      "chip-mute",
  draft:         "chip-mute",
  rejected:      "chip-red",
  retired:       "chip-mute",
  quarantined:   "chip-red",
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

// ── Elo color ──────────────────────────────────────────────
export const eloColor = (elo: number | null | undefined) => {
  if (elo == null)   return "text-ink-soft";
  if (elo >= 1260)   return "text-green";
  if (elo >= 1220)   return "text-blue";
  if (elo >= 1180)   return "text-ink";
  return "text-ink-soft";
};
