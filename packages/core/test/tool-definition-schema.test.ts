import { toolDefinitionIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";

describe("tool definition id", () => {
  it("brands a lowercase uuid as ToolDefinitionId", () => {
    const id = toolDefinitionIdSchema.parse("e0000000-0000-4000-8000-000000000001");
    expect(id).toBe("e0000000-0000-4000-8000-000000000001");
  });
  it("rejects an uppercase uuid", () => {
    expect(() => toolDefinitionIdSchema.parse("E0000000-0000-4000-8000-000000000001")).toThrow();
  });
});
