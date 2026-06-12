import { describe, it } from "vitest";
import { type AgentId, agentIdSchema } from "../src/agent-id.js";

describe("AgentId type regression", () => {
  it("each member is a valid AgentId", () => {
    const _a: AgentId = "aider";
    const _b: AgentId = "claude-code";
    const _c: AgentId = "codex";
    const _d: AgentId = "continue";
    const _e: AgentId = "cursor";
    const _f: AgentId = "gemini";
    const _g: AgentId = "generic-cli";
    const _h: AgentId = "windsurf";
    void _a;
    void _b;
    void _c;
    void _d;
    void _e;
    void _f;
    void _g;
    void _h;
  });

  it("non-member string is not assignable to AgentId", () => {
    // @ts-expect-error non-member literal is not AgentId
    const _bad: AgentId = "unknown-agent";
    void _bad;
  });

  it("non-member string-cast is not assignable to AgentId", () => {
    // @ts-expect-error arbitrary string is not assignable to AgentId
    const _bad: AgentId = "not-an-agent" as string;
    void _bad;
  });

  it("agentIdSchema.options spreads into AgentId[]", () => {
    // Verifies that options elements are assignable to AgentId at the type level.
    const arr: AgentId[] = [...agentIdSchema.options];
    void arr;
  });

  it("agentIdSchema.options preserves alphabetic order", () => {
    const _t: readonly [
      "aider",
      "claude-code",
      "codex",
      "continue",
      "cursor",
      "gemini",
      "generic-cli",
      "windsurf",
    ] = agentIdSchema.options;
    void _t;
  });
});
