import { toolDefinitionIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import {
  toolCategorySchema,
  toolDefinitionInputSchema,
  toolDefinitionSchema,
  toolRiskSchema,
} from "../src/tool-definition.js";

describe("tool definition id", () => {
  it("brands a lowercase uuid as ToolDefinitionId", () => {
    const id = toolDefinitionIdSchema.parse("e0000000-0000-4000-8000-000000000001");
    expect(id).toBe("e0000000-0000-4000-8000-000000000001");
  });
  it("rejects an uppercase uuid", () => {
    expect(() => toolDefinitionIdSchema.parse("E0000000-0000-4000-8000-000000000001")).toThrow();
  });
});

const VALID = {
  id: "e0000000-0000-4000-8000-000000000001",
  projectId: "11111111-1111-4111-8111-111111111111",
  name: "rg",
  description: "ripgrep search across the repo",
  category: "search",
  risk: "safe",
  inputSchema: null,
  outputSchema: null,
  keywords: ["search", "grep"],
  createdAt: "2026-06-12T00:00:00.000Z",
} as const;

describe("toolCategorySchema / toolRiskSchema", () => {
  it("preserves the 9-member category declaration order", () => {
    expect(toolCategorySchema.options).toEqual([
      "filesystem",
      "search",
      "git",
      "test",
      "package",
      "database",
      "deploy",
      "browser",
      "dangerous",
    ]);
  });
  it("preserves the 3-member risk declaration order", () => {
    expect(toolRiskSchema.options).toEqual(["safe", "medium", "dangerous"]);
  });
});

describe("toolDefinitionSchema", () => {
  it("parses a valid tool definition", () => {
    const parsed = toolDefinitionSchema.parse(VALID);
    expect(parsed.name).toBe("rg");
    expect(parsed.keywords).toEqual(["search", "grep"]);
  });
  it("normalizes keywords (lowercase, trim, de-dup, drop empties)", () => {
    const parsed = toolDefinitionSchema.parse({
      ...VALID,
      keywords: ["  Grep ", "grep", "", "Search"],
    });
    expect(parsed.keywords).toEqual(["grep", "search"]);
  });
  it("round-trips an opaque inputSchema unchanged", () => {
    const inputSchema = { type: "object", properties: { q: { type: "string" } } };
    const parsed = toolDefinitionSchema.parse({ ...VALID, inputSchema });
    expect(parsed.inputSchema).toEqual(inputSchema);
  });
  it("rejects an unknown category", () => {
    expect(() => toolDefinitionSchema.parse({ ...VALID, category: "network" })).toThrow();
  });
  it("rejects an unknown risk", () => {
    expect(() => toolDefinitionSchema.parse({ ...VALID, risk: "high" })).toThrow();
  });
  it("rejects an unknown key (strict)", () => {
    expect(() => toolDefinitionSchema.parse({ ...VALID, extra: 1 })).toThrow();
  });
});

describe("toolDefinitionInputSchema", () => {
  it("defaults keywords to [] and accepts optional opaque schemas", () => {
    const parsed = toolDefinitionInputSchema.parse({
      name: "git-commit",
      description: "stage and commit",
      category: "git",
      risk: "medium",
    });
    expect(parsed.keywords).toEqual([]);
    expect(parsed.inputSchema).toBeUndefined();
  });
  it("rejects an unknown key (strict)", () => {
    expect(() =>
      toolDefinitionInputSchema.parse({
        name: "x",
        description: "x",
        category: "git",
        risk: "safe",
        extra: 1,
      }),
    ).toThrow();
  });
});
