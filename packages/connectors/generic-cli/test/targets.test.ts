import { describe, expect, it } from "vitest";
import { builtinTargets, codexTarget, findTarget } from "../src/targets.js";

describe("ConnectorTarget registry", () => {
  it("ships the codex target", () => {
    expect(codexTarget).toEqual({
      id: "codex",
      agentId: "codex",
      relativePath: "AGENTS.md",
    });
  });

  it("findTarget returns the codex target by id", () => {
    expect(findTarget("codex")).toBe(codexTarget);
  });

  it("findTarget returns null for unknown ids", () => {
    expect(findTarget("missing")).toBeNull();
  });

  it("builtinTargets is frozen and contains codex", () => {
    expect(Object.isFrozen(builtinTargets)).toBe(true);
    expect(builtinTargets).toContain(codexTarget);
  });
});
