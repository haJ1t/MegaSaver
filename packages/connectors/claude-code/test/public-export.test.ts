import { describe, expect, test } from "vitest";

describe("public exports", () => {
  test("exports the Claude Code agent id", async () => {
    const connector = await import("../src/index.js");

    expect(connector.CLAUDE_CODE_AGENT_ID).toBe("claude-code");
  });
});
