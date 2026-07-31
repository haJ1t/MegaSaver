import { describe, expect, it } from "vitest";
import { evaluateShadowWorktree } from "../src/shadow-verdict.js";

describe("shadow-verdict", () => {
  it("evaluates shadow worktree and emits single-line verdict handle", () => {
    const verdict = evaluateShadowWorktree("commit_abc123", true);
    expect(verdict.isPassing).toBe(true);
    expect(verdict.handle).toMatch(/^mesh:\/\/verdict_[0-9a-f]{16}$/);
    expect(verdict.summary).toContain("single-line verdict");
  });
});
