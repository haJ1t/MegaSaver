import { describe, expect, test } from "vitest";
import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import {
  ClaudeCodeConnectorError,
  ClaudeCodeContextSchema,
  MEGA_SAVER_BLOCK_START,
  assertClaudeCodeContext,
} from "../src/index.js";
import { project, projectMemory, session, sessionMemory } from "./fixtures.js";

const otherProjectId = projectIdSchema.parse(
  "55555555-5555-4555-8555-555555555555",
);
const otherSessionId = sessionIdSchema.parse(
  "66666666-6666-4666-8666-666666666666",
);

function issuePaths(input: unknown): string[] {
  const result = ClaudeCodeContextSchema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.path.join("."));
}

describe("ClaudeCodeContextSchema", () => {
  test("accepts a valid Claude Code context", () => {
    const parsed = ClaudeCodeContextSchema.parse({
      project,
      session,
      memoryEntries: [projectMemory, sessionMemory],
    });

    expect(parsed.session?.agentId).toBe("claude-code");
    expect(parsed.memoryEntries).toHaveLength(2);
  });

  test("rejects a session from another agent", () => {
    const result = ClaudeCodeContextSchema.safeParse({
      project,
      session: { ...session, agentId: "generic-cli" },
      memoryEntries: [projectMemory],
    });

    expect(result.success).toBe(false);
  });

  test("rejects a session from another project", () => {
    expect(
      issuePaths({
        project,
        session: { ...session, projectId: otherProjectId },
        memoryEntries: [projectMemory],
      }),
    ).toContain("session.projectId");
  });

  test("rejects memory from another project", () => {
    expect(
      issuePaths({
        project,
        session,
        memoryEntries: [{ ...projectMemory, projectId: otherProjectId }],
      }),
    ).toContain("memoryEntries.0.projectId");
  });

  test("rejects session memory without matching session", () => {
    const result = ClaudeCodeContextSchema.safeParse({
      project,
      session: null,
      memoryEntries: [sessionMemory],
    });

    expect(result.success).toBe(false);
  });

  test("rejects session memory from another session", () => {
    expect(
      issuePaths({
        project,
        session,
        memoryEntries: [{ ...sessionMemory, sessionId: otherSessionId }],
      }),
    ).toContain("memoryEntries.0.sessionId");
  });

  test("rejects sentinel injection in rendered values", () => {
    const result = ClaudeCodeContextSchema.safeParse({
      project: { ...project, name: MEGA_SAVER_BLOCK_START },
      session,
      memoryEntries: [projectMemory],
    });

    expect(result.success).toBe(false);
  });

  test("assertClaudeCodeContext throws a typed connector error", () => {
    expect(() =>
      assertClaudeCodeContext({
        project,
        session: { ...session, agentId: "generic-cli" },
        memoryEntries: [],
      }),
    ).toThrow(ClaudeCodeConnectorError);
  });
});
