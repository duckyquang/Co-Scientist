import { useEffect, useState } from "react";
import { Trophy, Swords, GitBranch, Radar, BarChart3, Radio, X } from "lucide-react";
import {
  ActivityFeed, AnalyticsPanel, FeedbackPanel, Leaderboard, TournamentPanel,
} from "../session/panels";
import { ClusterMap } from "../session/ClusterMap";
import { LineageGraph } from "../session/LineageGraph";
import type {
  ClusterPoint, CostByAgent, Feedback, Hypothesis, LineageNode, Match, SSEvent,
} from "../../types";

const TABS = [
  { id: "leaderboard", label: "Leaderboard", icon: Trophy },
  { id: "tournament", label: "Tournament", icon: Swords },
  { id: "lineage", label: "Lineage", icon: GitBranch },
  { id: "clusters", label: "Clusters", icon: Radar },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "activity", label: "Activity", icon: Radio },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** The full interactive views (leaderboard / tournament / lineage / clusters /
 *  analytics / activity), reused wholesale in a slide-over so the chat thread
 *  stays primary while the depth is one click away. */
export function ExploreDrawer({
  sessionId, hyps, matches, eloHistory, lineage, clusters, cost, feedback, events, live,
  onSelect, onSent, onClose,
}: {
  sessionId: string;
  hyps: Hypothesis[];
  matches: Match[];
  eloHistory: Record<string, { i: number; elo: number }[]>;
  lineage: { nodes: LineageNode[]; edges: { source: string; target: string }[] };
  clusters: ClusterPoint[];
  cost: { by_agent: CostByAgent[]; summary: any };
  feedback: Feedback[];
  events: SSEvent[];
  live: boolean;
  onSelect: (id: string) => void;
  onSent: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabId>("leaderboard");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-sm no-print" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-3xl flex-col border-l border-line bg-bg shadow-2xl animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {TABS.map((t) => {
              const active = tab === t.id;
              let badge: number | null = null;
              if (t.id === "leaderboard") badge = hyps.length;
              else if (t.id === "tournament") badge = matches.length;
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
                    active ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"
                  }`}>
                  <t.icon className="h-3.5 w-3.5" />{t.label}
                  {badge != null && badge > 0 && (
                    <span className="rounded-full bg-surface-2 px-1.5 text-[10px] font-bold text-muted">{badge}</span>
                  )}
                </button>
              );
            })}
          </div>
          <button onClick={onClose} aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "leaderboard" && <Leaderboard hyps={hyps} onSelect={onSelect} eloSeries={eloHistory} />}
          {tab === "tournament" && <TournamentPanel matches={matches} eloSeries={eloHistory} onSelect={onSelect} />}
          {tab === "lineage" && (
            <div className="card p-4"><LineageGraph nodes={lineage.nodes} edges={lineage.edges} onSelect={onSelect} /></div>
          )}
          {tab === "clusters" && (
            <div className="card p-5"><ClusterMap points={clusters} onSelect={onSelect} /></div>
          )}
          {tab === "analytics" && <AnalyticsPanel byAgent={cost.by_agent} summary={cost.summary} />}
          {tab === "activity" && (
            <div className="space-y-5">
              <ActivityFeed events={events} live={live} />
              <FeedbackPanel sessionId={sessionId} feedback={feedback} onSent={onSent} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
