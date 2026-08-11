import { describe, expect, it } from "vitest";
import {
  ON_DEMAND_ALLOWLIST,
  isOnDemandAllowed,
  onDemandCmdSchema,
} from "../src/on-demand-gate.js";

describe("on-demand gate", () => {
  it("allows reads", () => {
    expect(isOnDemandAllowed("output:filter")).toBe(true);
    expect(isOnDemandAllowed("sessions:live")).toBe(true);
    expect(isOnDemandAllowed("context:yield")).toBe(true);
  });

  it("denies writes", () => {
    expect(isOnDemandAllowed("memory:create")).toBe(false);
    expect(isOnDemandAllowed("handoff:pack")).toBe(false);
  });

  it("denies unknown", () => {
    expect(isOnDemandAllowed("unknown:cmd")).toBe(false);
  });

  it("allowlist closed", () => {
    expect(ON_DEMAND_ALLOWLIST).toContain("context:yield");
    expect(ON_DEMAND_ALLOWLIST).toContain("sessions:live");
  });

  it("strict enum rejects typo", () => {
    expect(() => onDemandCmdSchema.parse("unknown:cmd")).toThrow();
    expect(() => onDemandCmdSchema.parse("output:filter")).not.toThrow();
  });
});
