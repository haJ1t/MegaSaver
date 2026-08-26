import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type AgentId, agentIdSchema } from "../src/agent-id.js";

// v1.1 catalog: the 39 harness-catalog ids (harness-autodetect, 2026-08-26)
// plus the synthetic generic-cli member. Alphabetic — AA3 convention.
const members: ReadonlyArray<AgentId> = [
  "aider",
  "amazon-q",
  "amp",
  "antigravity",
  "avante",
  "bits",
  "claude-code",
  "cline",
  "codex",
  "cody",
  "continue",
  "copilot",
  "crush",
  "cursor",
  "deepseek",
  "devin",
  "droid",
  "gemini",
  "generic-cli",
  "goose",
  "gpt-engineer",
  "gptme",
  "grok",
  "hermes",
  "iflow",
  "kilo-code",
  "mentat",
  "openclaw",
  "opencode",
  "openhands",
  "plandex",
  "qodo",
  "qwen",
  "refact",
  "roo-code",
  "tabby",
  "trae",
  "warp",
  "windsurf",
  "zed",
];

describe("agentIdSchema", () => {
  it("parses every connector id", () => {
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

  it("explicitly accepts 'gemini'", () => {
    expect(agentIdSchema.parse("gemini")).toBe("gemini");
  });

  it("explicitly accepts 'windsurf'", () => {
    expect(agentIdSchema.parse("windsurf")).toBe("windsurf");
  });

  it("explicitly accepts 'continue'", () => {
    expect(agentIdSchema.parse("continue")).toBe("continue");
  });

  it("explicitly accepts the user-named harness ids", () => {
    expect(agentIdSchema.parse("deepseek")).toBe("deepseek");
    expect(agentIdSchema.parse("openclaw")).toBe("openclaw");
    expect(agentIdSchema.parse("hermes")).toBe("hermes");
  });

  it("widens to 40 closed-set members (harness catalog 39 + generic-cli)", () => {
    expect(members).toHaveLength(40);
    expect(agentIdSchema.options).toHaveLength(40);
  });

  it("preserves alphabetic order — AA3 convention", () => {
    // Fixture + computed sort: the fixture catches member drift, the
    // computed sort catches hand-maintained order drift (review R2).
    expect(agentIdSchema.options).toEqual([...members]);
    expect([...agentIdSchema.options]).toEqual([...agentIdSchema.options].sort());
  });
});
