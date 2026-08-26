import { builtinTargets } from "@megasaver/connector-generic-cli";
import { describe, expect, it } from "vitest";
import { KNOWN_TARGETS } from "../../bridge/known-targets.js";

// The bridge mirror must stay in lockstep with the connector packages'
// builtin target set (plus the CLI-owned claude-code target). This is the
// drift guard for the "GUI-local mirror of apps/cli known-targets" contract.
describe("gui bridge known-targets mirror", () => {
  it("mirrors connector-generic-cli builtinTargets + claude-code (16 total)", () => {
    expect(KNOWN_TARGETS).toHaveLength(16);
    expect(KNOWN_TARGETS[0]?.id).toBe("claude-code");
    for (const target of builtinTargets) {
      expect(KNOWN_TARGETS).toContain(target);
    }
  });

  it("every mirrored target id is unique", () => {
    const ids = KNOWN_TARGETS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
