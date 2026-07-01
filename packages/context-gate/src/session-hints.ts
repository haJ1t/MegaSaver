import type { SessionHints } from "@megasaver/output-filter";
import type { ProjectId, SessionId } from "@megasaver/shared";

interface FailureSource {
  listSessionFailures(projectId: ProjectId, sessionId: SessionId): { errorOutput: string }[];
}

export function buildSessionHints(
  registry: FailureSource,
  projectId: ProjectId,
  sessionId: SessionId,
): SessionHints {
  const failures = registry.listSessionFailures(projectId, sessionId);
  return {
    recentFailures: failures.map((f) => f.errorOutput),
  };
}
