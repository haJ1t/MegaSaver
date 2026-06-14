import type { AuditSummary } from "@megasaver/stats";
import { useCallback, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "../components/states.js";
import type { BridgeError } from "../components/states.js";
import {
  type McpStatusResponse,
  fetchAudit,
  fetchMcpStatus,
  fetchMemory,
  fetchSessions,
} from "../lib/api-client.js";
import type { ViewId } from "../view-id.js";

type OverviewData = {
  audit: AuditSummary;
  sessions: number;
  memories: number;
  mcp: McpStatusResponse;
};

export function OverviewView({
  projectId,
  onNavigate,
}: {
  projectId: string;
  onNavigate: (view: ViewId) => void;
}): JSX.Element {
  const [data, setData] = useState<OverviewData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    setError(null);
    try {
      // Audit is the headline, but the page never depends on it being non-empty:
      // counts + MCP health are the fallback so a brand-new project still has a
      // populated dashboard (§5).
      const [audit, sessions, memories, mcp] = await Promise.all([
        fetchAudit(projectId, { window: "all" }),
        fetchSessions(projectId),
        fetchMemory(projectId),
        fetchMcpStatus(),
      ]);
      setData({ audit, sessions: sessions.length, memories: memories.length, mcp });
      setState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setState("error");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === "loading") return <LoadingState label="Loading overview…" />;
  if (state === "error" && error) return <ErrorState error={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading overview…" />;

  const { audit, sessions, memories, mcp } = data;
  const installed = mcp.agents.filter((a) => a.mcpInstalled).length;

  return (
    <section
      aria-label="Overview"
      className="flex flex-col gap-6 px-6 py-6 overflow-y-auto flex-1 min-h-0"
    >
      <div>
        <h2 className="text-sm text-text-muted uppercase tracking-widest mb-2">Token savings</h2>
        {audit.eventsTotal === 0 ? (
          <p className="text-xs text-text-muted">
            No audit events yet — savings appear once context packs run for this project.
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            <Card label="tokens before" value={audit.tokensBefore} />
            <Card label="tokens after" value={audit.tokensAfter} />
            <Card label="% saved" value={`${Math.round(audit.percentageSaved)}%`} accent />
            <Card label="rules applied" value={audit.rulesApplied} />
            <Card label="memories used" value={audit.memoriesRetrieved} />
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm text-text-muted uppercase tracking-widest mb-2">Project</h2>
        <div className="flex flex-wrap gap-3">
          <Card label="sessions" value={sessions} onClick={() => onNavigate("sessions")} />
          <Card label="memory entries" value={memories} onClick={() => onNavigate("memory")} />
          <Card
            label="agents w/ MCP"
            value={`${installed}/${mcp.agents.length}`}
            onClick={() => onNavigate("agent-setup")}
          />
        </div>
      </div>

      <div>
        <h2 className="text-sm text-text-muted uppercase tracking-widest mb-2">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          <QuickAction label="Sessions" onClick={() => onNavigate("sessions")} />
          <QuickAction label="Memory" onClick={() => onNavigate("memory")} />
          <QuickAction label="Rules" onClick={() => onNavigate("rules")} />
          <QuickAction label="Index" onClick={() => onNavigate("index")} />
          <QuickAction label="Context preview" onClick={() => onNavigate("context")} />
          <QuickAction label="Agent setup" onClick={() => onNavigate("agent-setup")} />
        </div>
      </div>
    </section>
  );
}

function Card({
  label,
  value,
  accent,
  onClick,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
  onClick?: () => void;
}): JSX.Element {
  const className = [
    "flex flex-col items-start px-4 py-3 rounded-md border min-w-[7rem]",
    accent ? "border-accent/40 bg-accent/10" : "border-border bg-surface-elevated",
    onClick ? "cursor-pointer hover:border-accent/40 transition-colors" : "",
  ].join(" ");
  const inner = (
    <>
      <span className="text-lg text-text-primary font-medium tabular-nums">{value}</span>
      <span className="text-xs text-text-muted">{label}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={`${className} text-left`}>
      {inner}
    </button>
  ) : (
    <div className={className}>{inner}</div>
  );
}

function QuickAction({ label, onClick }: { label: string; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 text-xs rounded-md border border-border bg-surface-elevated text-text-secondary hover:text-text-primary hover:border-accent/40 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {label}
    </button>
  );
}
