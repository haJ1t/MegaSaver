import { describe, expect, it } from "vitest";
import { AgentOfficeError } from "../src/errors.js";
import { resolveLauncherPermission } from "../src/permission.js";

describe("resolveLauncherPermission", () => {
  it("passes plan through", () => {
    expect(resolveLauncherPermission("plan", { allowFull: false })).toBe("plan");
  });

  it("passes acceptEdits through", () => {
    expect(resolveLauncherPermission("acceptEdits", { allowFull: false })).toBe("acceptEdits");
  });

  it("passes full when allowFull is true", () => {
    expect(resolveLauncherPermission("full", { allowFull: true })).toBe("full");
  });

  it("throws permission_denied for full when allowFull is false", () => {
    expect(() => resolveLauncherPermission("full", { allowFull: false })).toThrow(AgentOfficeError);
    try {
      resolveLauncherPermission("full", { allowFull: false });
    } catch (err) {
      expect(err).toBeInstanceOf(AgentOfficeError);
      expect((err as AgentOfficeError).code).toBe("permission_denied");
    }
  });
});
