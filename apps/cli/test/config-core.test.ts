import { describe, expect, it } from "vitest";
import { megaConfigSchema, resolveCoreMode } from "../src/config.js";

describe("mega config core", () => {
  it("parses on-demand", () => {
    expect(megaConfigSchema.parse({ core: "on-demand" }).core).toBe("on-demand");
    expect(megaConfigSchema.parse({ core: "daemon" }).core).toBe("daemon");
    expect(megaConfigSchema.parse({}).core).toBeUndefined();
  });

  it("rejects invalid", () => {
    expect(() => megaConfigSchema.parse({ core: "invalid" })).toThrow();
  });

  it("precedence flag>config", () => {
    expect(resolveCoreMode({ flagOnDemand: true, config: { core: "daemon" } })).toBe("on-demand");
    expect(resolveCoreMode({ flagDaemon: true, config: { core: "on-demand" } })).toBe("daemon");
    expect(resolveCoreMode({ config: { core: "on-demand" } })).toBe("on-demand");
    expect(resolveCoreMode({})).toBe("daemon");
  });
});
