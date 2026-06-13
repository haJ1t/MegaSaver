import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

describe("Phase 7 public surface", () => {
  it("exports the tool-router entity, enums, pure fns, and types", () => {
    expect(typeof core.toolDefinitionSchema.parse).toBe("function");
    expect(typeof core.toolDefinitionInputSchema.parse).toBe("function");
    expect(core.toolCategorySchema.options).toContain("deploy");
    expect(core.toolRiskSchema.options).toContain("dangerous");
    expect(typeof core.isBlockedTool).toBe("function");
    expect(typeof core.routeToolsForTask).toBe("function");
    expect(typeof core.buildToolDefinitionFromInput).toBe("function");
  });
});
