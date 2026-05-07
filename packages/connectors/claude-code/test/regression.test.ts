import {
  agentIdSchema,
  memoryEntryIdSchema,
  projectIdSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { renderClaudeCodeContext } from "../src/index.js";
import { PRE_REFACTOR_BLOCK } from "./regression-fixture.js";

describe("claude-code render — pre-refactor parity", () => {
  it("produces byte-identical output for the canonical context", () => {
    const projectId = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
    const sessionId = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
    const memoryId = memoryEntryIdSchema.parse("33333333-3333-4333-8333-333333333333");
    const agentId = agentIdSchema.parse("claude-code");
    const NOW = "2026-05-07T12:00:00.000Z";

    const ctx = {
      agentId,
      project: {
        id: projectId,
        name: "demo",
        rootPath: "/tmp/demo",
        createdAt: NOW,
        updatedAt: NOW,
      },
      session: {
        id: sessionId,
        projectId,
        agentId,
        riskLevel: "medium" as const,
        title: "smoke session",
        startedAt: NOW,
        endedAt: null,
      },
      memoryEntries: [
        {
          id: memoryId,
          projectId,
          sessionId,
          scope: "session" as const,
          content: "first",
          createdAt: NOW,
        },
      ],
    };

    expect(renderClaudeCodeContext(ctx)).toBe(PRE_REFACTOR_BLOCK);
  });
});
