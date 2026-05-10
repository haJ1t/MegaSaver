import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, agentIdSchema } from "../src/agent-id.js";

const members: ReadonlyArray<AgentId> = ["aider", "claude-code", "codex", "cursor", "generic-cli"];

describe("agentIdSchema", () => {
  it("parses every v0.1 connector id", () => {
    for (const m of members) {
      expect(agentIdSchema.parse(m)).toBe(m);
    }
  });

  it("rejects an unknown agent id", () => {
    const result = agentIdSchema.safeParse("unknown-agent");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.code).toBe("invalid_enum_value");
    }
  });

  it("property: any enum member is accepted", () => {
    fc.assert(
      fc.property(fc.constantFrom(...members), (m) => {
        expect(agentIdSchema.parse(m)).toBe(m);
      }),
    );
  });

  it("property: any string outside the enum is rejected", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !(members as readonly string[]).includes(s)),
        (s) => {
          expect(agentIdSchema.safeParse(s).success).toBe(false);
        },
      ),
    );
  });

  it("explicitly accepts 'cursor'", () => {
    expect(agentIdSchema.parse("cursor")).toBe("cursor");
  });

  it("explicitly accepts 'aider'", () => {
    expect(agentIdSchema.parse("aider")).toBe("aider");
  });

  it("widens to 5 closed-set members", () => {
    expect(members).toHaveLength(5);
  });

  it("preserves alphabetic order — AA3 convention", () => {
    expect(agentIdSchema.options).toEqual([
      "aider",
      "claude-code",
      "codex",
      "cursor",
      "generic-cli",
    ]);
  });
});
