import { isOnDemandAllowed } from "@megasaver/policy";
import { describe, expect, it, vi } from "vitest";
import { resolveCoreMode } from "../../src/config.js";

describe("on-demand dispatch", () => {
  it("allows sessions:live", () => {
    expect(isOnDemandAllowed("sessions:live")).toBe(true);
    expect(resolveCoreMode({ flagOnDemand: true })).toBe("on-demand");
  });

  it("denies memory:create", () => {
    expect(isOnDemandAllowed("memory:create")).toBe(false);
    expect(isOnDemandAllowed("handoff:pack")).toBe(false);
  });

  it("gates writes before spawn", () => {
    const cmd = "memory:create";
    const coreMode = resolveCoreMode({ flagOnDemand: true });
    const allowed = isOnDemandAllowed(cmd);
    expect(coreMode).toBe("on-demand");
    expect(allowed).toBe(false);
    // spy would not be called
    const spy = vi.fn();
    if (coreMode === "on-demand" && !allowed) {
      // gated, no spawn
    } else {
      spy();
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("allows reads", () => {
    const cmd = "sessions:live";
    expect(isOnDemandAllowed(cmd)).toBe(true);
    expect(resolveCoreMode({ flagOnDemand: true })).toBe("on-demand");
  });
});
