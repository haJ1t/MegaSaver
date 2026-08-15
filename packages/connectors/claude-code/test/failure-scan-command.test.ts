import { describe, expect, it } from "vitest";
import { buildHookCommand } from "../src/index.js";

describe("buildHookCommand failure-scan", () => {
  it("builds the bare and store-baked forms", () => {
    expect(buildHookCommand("failure-scan")).toBe("mega hooks failure-scan");
    expect(buildHookCommand("failure-scan", { storeRoot: "/tmp/store" })).toBe(
      "mega hooks failure-scan --store /tmp/store",
    );
  });
});
