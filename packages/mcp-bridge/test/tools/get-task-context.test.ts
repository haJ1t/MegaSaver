import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextPackSchema } from "@megasaver/context-pruner";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { buildIndex } from "@megasaver/indexer";
import { afterEach, describe, expect, it } from "vitest";
import { McpBridgeError } from "../../src/errors.js";
import { handleGetTaskContext } from "../../src/tools/get-task-context.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-07-01T00:00:00.000Z";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("get_task_context", () => {
  it("returns a task-scoped pack with included blocks", async () => {
    const store = mkdtempSync(join(tmpdir(), "task-ctx-store-"));
    const repo = mkdtempSync(join(tmpdir(), "task-ctx-repo-"));
    dirs.push(store, repo);
    mkdirSync(join(repo, "src"));
    writeFileSync(
      join(repo, "src", "auth.ts"),
      "export function validateToken(t: string) {\n  return t.length > 0;\n}\n",
    );
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID as never });
    const registry = createInMemoryCoreRegistry();
    registry.createProject({
      id: PROJECT_ID as never,
      name: "demo",
      rootPath: repo,
      createdAt: TS,
      updatedAt: TS,
    });
    const pack = await handleGetTaskContext(
      { registry, storeRoot: store },
      { projectId: PROJECT_ID, task: "fix validateToken" },
    );
    expect(contextPackSchema.safeParse(pack).success).toBe(true);
    expect(pack.task).toBe("fix validateToken");
    expect(pack.included.length).toBeGreaterThan(0);
    expect(pack.included.some((b) => b.name === "validateToken")).toBe(true);
  });

  it("rejects a missing task", async () => {
    const registry = createInMemoryCoreRegistry();
    await expect(
      handleGetTaskContext({ registry, storeRoot: "/tmp" }, { projectId: PROJECT_ID }),
    ).rejects.toThrow(McpBridgeError);
  });

  it("rejects an unknown project", async () => {
    const registry = createInMemoryCoreRegistry();
    await expect(
      handleGetTaskContext(
        { registry, storeRoot: "/tmp" },
        { projectId: "99999999-9999-4999-8999-999999999999", task: "x" },
      ),
    ).rejects.toThrow(/project not found/);
  });
});
