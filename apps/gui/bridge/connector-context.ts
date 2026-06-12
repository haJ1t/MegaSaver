import type { ConnectorTarget } from "@megasaver/connector-generic-cli";
import type { ConnectorContext } from "@megasaver/connectors-shared";
import type { CoreRegistry, Project } from "@megasaver/core";

// GUI-local mirror of apps/cli connector/shared.ts buildConnectorContext:
// resolves the latest open session for the target agent plus that
// session's (and project-scope) memory entries into a ConnectorContext.
// Lives here so the bridge can call syncTargetBlock without importing
// the CLI (apps do not depend on apps; AA1 §3). The BB8↔BB11 seam —
// delete if BB11 lands a shared GUI connector-context builder.
export function buildBridgeConnectorContext(
  registry: CoreRegistry,
  target: ConnectorTarget,
  project: Project,
): ConnectorContext {
  const sessions = registry.listSessions(project.id);
  const open = sessions.filter((s) => s.endedAt === null && s.agentId === target.agentId);
  const session =
    open.length === 0
      ? null
      : open.reduce((latest, current) =>
          Date.parse(current.startedAt) > Date.parse(latest.startedAt) ? current : latest,
        );

  const memoryEntries = registry
    .listMemoryEntries(project.id)
    .filter(
      (e) =>
        e.approval === "approved" &&
        (e.scope === "project" || (session !== null && e.sessionId === session.id)),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 20);

  return { agentId: target.agentId, project, session, memoryEntries };
}
