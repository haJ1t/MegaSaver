import { useCallback, useEffect, useRef, useState } from "react";
import { AgentSetupRow, type McpAction } from "../components/agent-setup-row.js";
import { ErrorState, LoadingState } from "../components/states.js";
import type { BridgeError } from "../components/states.js";
import {
  type McpAgentStatus,
  fetchMcpStatus,
  installMcp,
  repairMcp,
  uninstallMcp,
} from "../lib/api-client.js";

type AgentSetupDoctorProps = {
  // From the app shell. install/repair need a project (epic §7); null disables
  // those actions. Status + uninstall do not depend on it.
  activeProjectId: string | null;
};

export function AgentSetupDoctor({ activeProjectId }: AgentSetupDoctorProps): JSX.Element {
  const [agents, setAgents] = useState<McpAgentStatus[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [busyAgent, setBusyAgent] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      const status = await fetchMcpStatus();
      setAgents(status.agents);
      setLoadState("ready");
    } catch (err) {
      setError(err as BridgeError);
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function runAction(agentId: string, action: McpAction): Promise<void> {
    // install/repair require a project; the row disables them when none is
    // selected, so this guard is belt-and-suspenders.
    if ((action === "install" || action === "repair") && activeProjectId === null) return;
    setBusyAgent(agentId);
    setError(null);
    try {
      if (action === "install") await installMcp(agentId, activeProjectId as string);
      else if (action === "repair") await repairMcp(agentId, activeProjectId as string);
      else await uninstallMcp(agentId);
      await load();
    } catch (err) {
      setError(err as BridgeError);
    } finally {
      setBusyAgent(null);
    }
  }

  return (
    <section aria-label="Agent setup" className="flex flex-col gap-6 px-6 py-6 overflow-y-auto">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-medium text-text-primary">Agent setup</h2>
        <p className="text-sm text-text-muted">
          Install and repair the Mega Saver MCP server for each connected agent.
        </p>
      </header>

      {loadState === "loading" && <LoadingState label="Checking agent setup…" />}

      {error && (
        <div ref={errorRef} tabIndex={-1}>
          <ErrorState error={error} onRetry={() => void load()} />
        </div>
      )}

      {loadState === "ready" && (
        <ul className="flex flex-col gap-3">
          {agents.map((agent) => (
            <AgentSetupRow
              key={agent.agentId}
              agent={agent}
              busy={busyAgent === agent.agentId}
              projectSelected={activeProjectId !== null}
              onAction={(action) => void runAction(agent.agentId, action)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
