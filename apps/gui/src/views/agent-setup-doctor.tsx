import { useCallback, useEffect, useRef, useState } from "react";
import { AgentSetupRow, type McpAction } from "../components/agent-setup-row.js";
import { ErrorState, LoadingState } from "../components/states.js";
import type { BridgeError } from "../components/states.js";
import {
  type McpAgentStatus,
  type Project,
  fetchMcpStatus,
  fetchProjects,
  installMcp,
  repairMcp,
  uninstallMcp,
} from "../lib/api-client.js";

export function AgentSetupDoctor(): JSX.Element {
  const [agents, setAgents] = useState<McpAgentStatus[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<BridgeError | null>(null);
  const [busyAgent, setBusyAgent] = useState<string | null>(null);
  // WCAG 4.1.3: action outcomes (the primary success path) must reach AT. The
  // row re-renders silently on load(), so a polite live region announces them.
  const [announcement, setAnnouncement] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const loadRequestRef = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const id = ++loadRequestRef.current;
    setLoadState("loading");
    setError(null);
    try {
      const [status, list] = await Promise.all([fetchMcpStatus(), fetchProjects()]);
      if (id !== loadRequestRef.current) return;
      setAgents(status.agents);
      setProjects(list);
      setSelectedProject((current) =>
        current.length === 0 && list.length === 1 ? (list[0]?.name ?? current) : current,
      );
      setLoadState("ready");
    } catch (err) {
      if (id !== loadRequestRef.current) return;
      setError(err as BridgeError);
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    let live = true;
    let requestId = 0;
    const run = async (): Promise<void> => {
      const id = ++requestId;
      setLoadState("loading");
      setError(null);
      try {
        const [status, list] = await Promise.all([fetchMcpStatus(), fetchProjects()]);
        if (!live || id !== requestId) return;
        setAgents(status.agents);
        setProjects(list);
        if (list.length === 1) {
          const only = list[0];
          if (only) setSelectedProject(only.name);
        }
        setLoadState("ready");
      } catch (err) {
        if (!live || id !== requestId) return;
        setError(err as BridgeError);
        setLoadState("error");
      }
    };
    void run();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function runAction(agentId: string, action: McpAction): Promise<void> {
    if (action !== "uninstall" && selectedProject.length === 0) return;
    setBusyAgent(agentId);
    setError(null);
    setAnnouncement("");
    try {
      if (action === "install") await installMcp(agentId, selectedProject);
      else if (action === "repair") await repairMcp(agentId, selectedProject);
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

  const canAct = loadState === "ready" && selectedProject.length > 0;
  const projectChoice =
    projects.length === 0 ? (
      loadState === "ready" ? (
        <p className="text-sm text-text-muted">Create a project first to set up an agent.</p>
      ) : null
    ) : projects.length === 1 ? (
      <p className="text-sm text-text-muted">
        Project: <span className="text-text-primary">{projects[0]?.name ?? ""}</span>
      </p>
    ) : (
      <label className="flex items-center gap-2 text-sm text-text-muted">
        Project
        <select
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text-primary"
        >
          <option value="">Select a project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
    );

  return (
    <section aria-label="Agent setup" className="max-w-[880px] flex flex-col gap-3.5 px-5 py-7">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Setup</h1>
        <p className="mt-1 mb-0 text-text-secondary">
          Connect Mega Saver to the coding agents on this machine. One click each.
        </p>
      </header>

      {/* <output> carries an implicit role=status (aria-live=polite); biome
          a11y/useSemanticElements prefers it over <p role="status">. */}
      <output aria-live="polite" className="sr-only">
        {announcement}
      </output>

      {projectChoice}

      {loadState === "loading" && <LoadingState label="Checking agent setup…" />}

      {error && (
        <div ref={errorRef} tabIndex={-1}>
          <ErrorState error={error} onRetry={() => void load()} />
        </div>
      )}

      {loadState === "ready" && (
        <ul className="flex flex-col gap-3 list-none m-0 p-0">
          {agents.map((agent) => (
            <AgentSetupRow
              key={agent.agentId}
              agent={agent}
              busy={busyAgent === agent.agentId}
              disabled={!canAct}
              onAction={(action) => void runAction(agent.agentId, action)}
            />
          ))}
        </ul>
      )}

      <section className="px-5 py-4 rounded-xl border border-dashed border-border">
        <h2 className="m-0 mb-1 text-sm font-semibold">Prefer the terminal?</h2>
        <p className="m-0 mb-2.5 text-sm text-text-secondary">
          Everything here has a command-line equivalent.
        </p>
        {/* Must stay runnable verbatim. @megasaver/cli is bin-only (no exports
            map), so these cannot be asserted against the citty tree without a
            cross-package deep import (CLAUDE.md §8). agent-setup-doctor.test.tsx
            pins the strings instead, so changing them is a deliberate act that
            forces re-checking against:
              apps/cli/src/commands/mcp/install.ts
              apps/cli/src/commands/session/saver/workspace.ts
              apps/cli/src/commands/index/build.ts  (projectName is positional) */}
        <div className="flex flex-col gap-1 font-mono text-xs text-text-secondary">
          <code>mega mcp install --target claude-code</code>
          <code>mega session saver workspace enable --mode balanced</code>
          <code>mega index build &lt;project&gt;</code>
        </div>
      </section>
    </section>
  );
}
