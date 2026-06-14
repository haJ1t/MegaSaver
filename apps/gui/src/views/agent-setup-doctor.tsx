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

export function AgentSetupDoctor(): JSX.Element {
  const [agents, setAgents] = useState<McpAgentStatus[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [busyAgent, setBusyAgent] = useState<string | null>(null);
  // WCAG 4.1.3: action outcomes (the primary success path) must reach AT. The
  // row re-renders silently on load(), so a polite live region announces them.
  const [announcement, setAnnouncement] = useState("");
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
    setBusyAgent(agentId);
    setError(null);
    setAnnouncement("");
    try {
      if (action === "install") await installMcp(agentId);
      else if (action === "repair") await repairMcp(agentId);
      else await uninstallMcp(agentId);
      await load();
      setAnnouncement(
        action === "uninstall"
          ? `Mega Saver MCP removed for ${agentId}.`
          : `Mega Saver MCP ${action === "install" ? "set up" : "repaired"} for ${agentId}. Restart ${agentId} to load it.`,
      );
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

      {/* <output> carries an implicit role=status (aria-live=polite); biome
          a11y/useSemanticElements prefers it over <p role="status">. */}
      <output aria-live="polite" className="sr-only">
        {announcement}
      </output>

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
              onAction={(action) => void runAction(agent.agentId, action)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
