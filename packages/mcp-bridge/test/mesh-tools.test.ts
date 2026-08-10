import { describe, expect, it } from "vitest";
import { TOOL_INPUT_SCHEMAS } from "../src/tool-schemas.js";

describe("MCP mesh tools registry", () => {
  it("TOOL_INPUT_SCHEMAS contains mesh_broadcast and mesh_query", () => {
    expect(TOOL_INPUT_SCHEMAS).toHaveProperty("mesh_broadcast");
    expect(TOOL_INPUT_SCHEMAS).toHaveProperty("mesh_query");
  });
});
