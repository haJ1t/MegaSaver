import { describe, expect, it } from "vitest";
import { buildForkPoint } from "../../src/fork/model.js";

describe("fork", () => {
  it("builds and renders", async () => {
    const { renderForkCapsule } = await import("../../src/fork/model.js");
    const p = buildForkPoint({ workspaceKey: "wk1", now: () => 1000, gitAvailable: true });
    const text = renderForkCapsule(p);
    expect(text).toContain("Fork");
  });
});
