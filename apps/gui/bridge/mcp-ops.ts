import { join } from "node:path";
import { parseBlock, readTargetFile, syncTargetBlock } from "@megasaver/connectors-shared";
import type { CoreRegistry } from "@megasaver/core";
import { type KnownAgentId, type McpSetupOps, buildMcpSetupOps } from "@megasaver/mcp-bridge";
import { buildBridgeConnectorContext } from "./connector-context.js";
import { KNOWN_TARGETS } from "./known-targets.js";

export type CreateMcpOpsDeps = {
  registry: CoreRegistry;
  home: string;
  command: string;
  // Launch args written with command so the GUI-initiated install
  // produces a runnable config (e.g. ["mcp", "serve"]).
  args?: string[];
};

// F3: build the production McpSetupOps for the GUI bridge. The
// connectorSynced resolver + connectorSync side effect are GUI-local
// (over @megasaver/connectors-shared) so neither the GUI nor
// mcp-bridge imports the CLI (AA1 §3 arrow). Mirrors the CLI's
// resolver semantics so CLI and GUI agree.
export function createMcpOps(deps: CreateMcpOpsDeps): McpSetupOps {
  const targetFor = (agentId: KnownAgentId) => KNOWN_TARGETS.find((t) => t.id === agentId) ?? null;

  return buildMcpSetupOps({
    home: deps.home,
    command: deps.command,
    ...(deps.args !== undefined ? { args: deps.args } : {}),
    connectorSyncedResolver: async (agentId) => {
      const target = targetFor(agentId);
      if (target === null) return false;
      // connectorSynced is project-scoped; the GUI resolves the
      // project root per agent's latest open session's project.
      const project = resolveProjectRoot(deps.registry, target.agentId);
      if (project === null) return false;
      const existing = await readTargetFile(join(project.rootPath, target.relativePath));
      return existing !== null && parseBlock(existing).block !== null;
    },
    connectorSync: async (agentId, projectName) => {
      const target = targetFor(agentId);
      if (target === null) return;
      const project = deps.registry.listProjects().find((p) => p.name === projectName);
      if (project === undefined) return;
      const context = buildBridgeConnectorContext(deps.registry, target, project);
      await syncTargetBlock({
        absPath: join(project.rootPath, target.relativePath),
        context,
      });
    },
  });
}

// Latest project owning an open session for this agent; null if none.
function resolveProjectRoot(registry: CoreRegistry, agentId: string): { rootPath: string } | null {
  for (const project of registry.listProjects()) {
    const hasAgentSession = registry.listSessions(project.id).some((s) => s.agentId === agentId);
    if (hasAgentSession) return { rootPath: project.rootPath };
  }
  return null;
}
