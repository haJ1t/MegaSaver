import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolDefinition } from "@megasaver/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readToolDefinitionsForProject,
  resolveStorePaths,
  writeToolDefinitionsForProject,
} from "../src/json-directory-store.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ToolDefinition["projectId"];

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mega-tools-store-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const TOOL: ToolDefinition = {
  id: "e0000000-0000-4000-8000-000000000001" as ToolDefinition["id"],
  projectId: PROJECT_ID,
  name: "rg",
  description: "ripgrep",
  category: "search",
  risk: "safe",
  inputSchema: { type: "object", properties: { q: { type: "string" } } },
  outputSchema: null,
  keywords: ["search"],
  createdAt: "2026-06-12T00:00:00.000Z",
};

describe("tool-definitions store round-trip", () => {
  it("writes then reads back, preserving an opaque inputSchema", () => {
    const paths = resolveStorePaths(root);
    writeToolDefinitionsForProject(paths, PROJECT_ID, [TOOL]);
    const read = readToolDefinitionsForProject(paths, PROJECT_ID);
    expect(read).toEqual([TOOL]);
    expect(read[0]?.inputSchema).toEqual(TOOL.inputSchema);
  });
  it("empty set removes the file (reads back as empty)", () => {
    const paths = resolveStorePaths(root);
    writeToolDefinitionsForProject(paths, PROJECT_ID, [TOOL]);
    writeToolDefinitionsForProject(paths, PROJECT_ID, []);
    expect(readToolDefinitionsForProject(paths, PROJECT_ID)).toEqual([]);
  });
});
