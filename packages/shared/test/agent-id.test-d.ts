import { describe, it } from "vitest";
import { type AgentId, agentIdSchema } from "../src/agent-id.js";

describe("AgentId type regression", () => {
  it("each v0.1 member is a valid AgentId", () => {
    const _a: AgentId = "aider";
    const _b: AgentId = "claude-code";
    const _c: AgentId = "codex";
    const _d: AgentId = "cursor";
    const _e: AgentId = "generic-cli";
    void _a;
    void _b;
    void _c;
    void _d;
    void _e;
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
    const _t: readonly ["aider", "claude-code", "codex", "cursor", "generic-cli"] =
      agentIdSchema.options;
    void _t;
  });
});
