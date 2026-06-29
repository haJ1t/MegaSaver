import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextPackSchema } from "@megasaver/context-pruner";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { buildIndex } from "@megasaver/indexer";
import { afterEach, describe, expect, it } from "vitest";
import { McpBridgeError } from "../../src/errors.js";
import { handleImpact } from "../../src/tools/impact.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111112";
const TS = "2026-06-11T00:00:00.000Z";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(): {
  env: { registry: ReturnType<typeof createInMemoryCoreRegistry>; storeRoot: string };
} {
  const store = mkdtempSync(join(tmpdir(), "mcp-imp-store-"));
  const repo = mkdtempSync(join(tmpdir(), "mcp-imp-repo-"));
  dirs.push(store, repo);
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "core.ts"), "export function root() { return 1; }\n");
  writeFileSync(join(repo, "src", "mid.ts"), "export function mid() { return root(); }\n");
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

describe("mega_impact MCP tool", () => {
  it("returns a schema-valid pack containing the symbol and its callers", () => {
    const { env } = setup();
    const pack = handleImpact(env, { projectId: PROJECT_ID, symbol: "root" });
    expect(contextPackSchema.safeParse(pack).success).toBe(true);
    expect(pack.included.map((b) => b.name).sort()).toEqual(["mid", "root"]);
  });

  it("returns an empty pack for an unknown symbol (no crash)", () => {
    const { env } = setup();
    const pack = handleImpact(env, { projectId: PROJECT_ID, symbol: "ghost" });
    expect(pack.included).toEqual([]);
  });

  it("rejects a missing symbol", () => {
    const { env } = setup();
    expect(() => handleImpact(env, { projectId: PROJECT_ID })).toThrow(McpBridgeError);
  });

  it("rejects an unknown project", () => {
    const { env } = setup();
    expect(() =>
      handleImpact(env, {
        projectId: "22222222-2222-4222-8222-222222222222",
        symbol: "root",
      }),
    ).toThrowError(/project not found/);
  });
});
