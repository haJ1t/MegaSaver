import type { McpAgentStatus } from "../lib/api-client.js";

export type McpAction = "install" | "repair" | "uninstall";

type AgentSetupRowProps = {
  agent: McpAgentStatus;
  busy: boolean;
  onAction: (action: McpAction) => void;
};

type RowState = {
  label: string;
  tone: "muted" | "warn" | "ok";
  action: McpAction | null;
  actionLabel: string;
};

function deriveState(agent: McpAgentStatus): RowState {
  if (!agent.mcpInstalled) {
    return { label: "Not installed", tone: "muted", action: "install", actionLabel: "Set up" };
  }
  if (!agent.connectorSynced) {
    return { label: "Config missing", tone: "warn", action: "repair", actionLabel: "Repair" };
  }
  // Installed + synced = Ready, with Uninstall always reachable. restartRequired
  // is NOT a lifecycle state (the backend sets it = mcpInstalled, so it is true
  // for every ready agent); it surfaces as the additive restart-hint notice
  // below, never as an action-suppressing branch.
  return { label: "Ready", tone: "ok", action: "uninstall", actionLabel: "Uninstall" };
}

const TONE: Record<RowState["tone"], string> = {
  muted: "text-text-muted",
  warn: "text-danger",
  ok: "text-accent",
};

export function AgentSetupRow({ agent, busy, onAction }: AgentSetupRowProps): JSX.Element {
  const state = deriveState(agent);
  const isDestructive = state.action === "uninstall";
  const disabled = busy;

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-text-primary">{agent.agentId}</span>
          <span className={`text-xs ${TONE[state.tone]}`}>{state.label}</span>
        </div>
        {state.action && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => state.action && onAction(state.action)}
            className={[
              "rounded-md px-4 py-1.5 text-sm cursor-pointer transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              isDestructive
                ? "border border-danger/40 text-danger hover:bg-danger/5"
                : "bg-accent text-accent-fg hover:opacity-90",
            ].join(" ")}
          >
            {busy ? "Working…" : state.actionLabel}
          </button>
        )}
      </div>
      {agent.restartRequired && agent.restartHint.length > 0 && (
        <p className="text-xs text-text-muted">{agent.restartHint}</p>
      )}
    </li>
  );
}
