import { describe, expect, test } from "vitest";
import {
  ClaudeCodeConnectorError,
  ClaudeCodeContextSchema,
  MEGA_SAVER_BLOCK_START,
  assertClaudeCodeContext,
} from "../src/index.js";
import { project, projectMemory, session, sessionMemory } from "./fixtures.js";

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

  test("rejects session memory without matching session", () => {
    const result = ClaudeCodeContextSchema.safeParse({
      project,
      session: null,
      memoryEntries: [sessionMemory],
    });

    expect(result.success).toBe(false);
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
