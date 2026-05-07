import { memoryEntryIdSchema, projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import type { AgentId, MemoryEntryId } from "@megasaver/shared";

export const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
export const SESSION_ID = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
export const MEMORY_ID = memoryEntryIdSchema.parse("33333333-3333-4333-8333-333333333333");
const NOW = "2026-05-07T12:00:00.000Z";

export function buildContext(overrides?: {
  agentId?: AgentId;
  projectName?: string;
  withSession?: boolean;
  memoryEntries?: Array<{
    id: MemoryEntryId;
    scope: "project" | "session";
    content: string;
  }>;
}) {
  const agentId: AgentId = overrides?.agentId ?? "claude-code";
  const withSession = overrides?.withSession ?? false;
  return {
    agentId,
    project: {
      id: PROJECT_ID,
      name: overrides?.projectName ?? "demo",
      rootPath: "/tmp/demo",
      createdAt: NOW,
      updatedAt: NOW,
    },
    session: withSession
      ? {
          id: SESSION_ID,
          projectId: PROJECT_ID,
          agentId,
          riskLevel: "medium" as const,
          title: "smoke session",
          startedAt: NOW,
          endedAt: null,
        }
      : null,
    memoryEntries: (overrides?.memoryEntries ?? []).map((entry) => ({
      id: entry.id,
      projectId: PROJECT_ID,
      sessionId: entry.scope === "session" ? SESSION_ID : null,
      scope: entry.scope,
      content: entry.content,
      createdAt: NOW,
    })),
  };
}
