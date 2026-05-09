import { describe, expect, it } from "vitest";
import { aiderTarget, builtinTargets, codexTarget, cursorTarget, findTarget } from "../src/targets.js";

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

  it("ships the cursor target", () => {
    expect(cursorTarget.id).toBe("cursor");
    expect(cursorTarget.agentId).toBe("cursor");
    expect(cursorTarget.relativePath).toBe(".cursor/rules/megasaver.mdc");
  });

  it("cursorTarget header is a Cursor frontmatter block", () => {
    const h = cursorTarget.header;
    expect(h).toBeDefined();
    expect(h ?? "").toMatch(/^---\n/);
    expect(h ?? "").toContain("alwaysApply: true");
    expect(h ?? "").toContain("description: Mega Saver project context");
    expect(h ?? "").toMatch(/---\n\n$/);
  });

  it("findTarget returns the cursor target by id", () => {
    expect(findTarget("cursor")).toBe(cursorTarget);
  });

  it("builtinTargets contains codex, cursor, and aider", () => {
    expect(builtinTargets).toHaveLength(3);
    expect(builtinTargets).toContain(codexTarget);
    expect(builtinTargets).toContain(cursorTarget);
    expect(builtinTargets).toContain(aiderTarget);
  });

  it("codexTarget has no header (legacy targets stay byte-identical)", () => {
    expect(codexTarget.header).toBeUndefined();
  });

  it("ships the aider target", () => {
    expect(aiderTarget.id).toBe("aider");
    expect(aiderTarget.agentId).toBe("aider");
    expect(aiderTarget.relativePath).toBe("CONVENTIONS.md");
  });

  it("aiderTarget has no header (markdown plain target)", () => {
    expect(aiderTarget.header).toBeUndefined();
  });

  it("findTarget returns the aider target by id", () => {
    expect(findTarget("aider")).toBe(aiderTarget);
  });
});
