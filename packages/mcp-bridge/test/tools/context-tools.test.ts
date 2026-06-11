import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextPackSchema } from "@megasaver/context-pruner";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { buildIndex } from "@megasaver/indexer";
import { afterEach, describe, expect, it } from "vitest";
import { McpBridgeError } from "../../src/errors.js";
import {
  handleGetContextBudgetReport,
  handleGetRelevantCodeBlocks,
  handleGetRelevantContext,
} from "../../src/tools/context-pruning.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-06-11T00:00:00.000Z";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(): {
  env: { registry: ReturnType<typeof createInMemoryCoreRegistry>; storeRoot: string };
} {
  const store = mkdtempSync(join(tmpdir(), "mcp-ctx-store-"));
  const repo = mkdtempSync(join(tmpdir(), "mcp-ctx-repo-"));
  dirs.push(store, repo);
  mkdirSync(join(repo, "src"));
  writeFileSync(
    join(repo, "src", "auth.ts"),
    "export function validateToken(t: string) {\n  return t.length > 0;\n}\n",
  );
  buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID as never });
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID as never,
    name: "demo",
    rootPath: repo,
    createdAt: TS,
    updatedAt: TS,
  });
  return { env: { registry, storeRoot: store } };
}

describe("context MCP tools", () => {
  it("get_relevant_context returns a schema-valid pack", () => {
    const { env } = setup();
    const pack = handleGetRelevantContext(env, {
      projectId: PROJECT_ID,
      task: "fix validateToken",
    });
    expect(contextPackSchema.safeParse(pack).success).toBe(true);
    expect(pack.included.some((b) => b.name === "validateToken")).toBe(true);
  });

  it("get_relevant_code_blocks projects the included blocks", () => {
    const { env } = setup();
    const blocks = handleGetRelevantCodeBlocks(env, {
      projectId: PROJECT_ID,
      task: "validateToken",
    });
    expect(Array.isArray(blocks)).toBe(true);
  });

  it("get_context_budget_report returns audit numbers", () => {
    const { env } = setup();
    const audit = handleGetContextBudgetReport(env, { projectId: PROJECT_ID, task: "auth" });
    expect(audit.blocksConsidered).toBeGreaterThanOrEqual(1);
  });

  it("rejects a missing task", () => {
    const { env } = setup();
    expect(() => handleGetRelevantContext(env, { projectId: PROJECT_ID })).toThrow(McpBridgeError);
  });

  it("rejects an unknown project", () => {
    const { env } = setup();
    expect(() =>
      handleGetRelevantContext(env, {
        projectId: "22222222-2222-4222-8222-222222222222",
        task: "x",
      }),
    ).toThrowError(/project not found/);
  });
});
