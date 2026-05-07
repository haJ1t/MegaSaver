import { memoryEntryIdSchema, projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import type { AgentId } from "@megasaver/shared";

export const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
export const SESSION_ID = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
export const MEMORY_ID = memoryEntryIdSchema.parse("33333333-3333-4333-8333-333333333333");
const NOW = "2026-05-07T12:00:00.000Z";

export function buildCodexContext(overrides?: { agentId?: AgentId }) {
  const agentId: AgentId = overrides?.agentId ?? "codex";
  return {
    agentId,
    project: {
      id: PROJECT_ID,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: NOW,
      updatedAt: NOW,
    },
    session: null,
    memoryEntries: [],
  };
}
