import { describe, expect, it } from "vitest";
import { evaluateShadowWorktreeScaffold } from "../src/shadow-verdict.js";

describe("shadow-verdict (Scaffold Check)", () => {
  it("evaluates shadow worktree scaffold simulator and returns scaffold status", () => {
    const verdict = evaluateShadowWorktreeScaffold("commit_abc123", true);
    expect(verdict.isPassing).toBe(true);
    expect(verdict.isScaffold).toBe(true);
    expect(verdict.handle).toMatch(/^msr:\/\/verdict_[0-9a-f]{16}$/);
    expect(verdict.summary).toContain("[Scaffold]");
  });
});
