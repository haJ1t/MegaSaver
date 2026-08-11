import { describe, expect, it } from "vitest";
import { buildForkPoint, diffForkPoints, renderForkCapsule } from "../../src/fork/model.js";

describe("fork model", () => {
  it("build hash stable", () => {
    const a = buildForkPoint({ workspaceKey: "wk1", now: () => 1000, gitAvailable: true });
    const b = buildForkPoint({ workspaceKey: "wk1", now: () => 1000, gitAvailable: true });
    expect(a.forkId).not.toBe(b.forkId); // random, but createdAt same
    expect(a.workspaceKey).toBe("wk1");
  });

  it("render bounded", () => {
    const p = buildForkPoint({ workspaceKey: "wk1", now: () => 1000, gitAvailable: true });
    const text = renderForkCapsule(p);
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(2000);
  });

  it("diff shows label", () => {
    const a = buildForkPoint({ workspaceKey: "wk1", label: "a", now: () => 1000, gitAvailable: true });
    const b = buildForkPoint({ workspaceKey: "wk1", label: "b", now: () => 2000, gitAvailable: true });
    const d = diffForkPoints(a, b);
    expect(d).toContain("a");
    expect(d).toContain("b");
  });
});
