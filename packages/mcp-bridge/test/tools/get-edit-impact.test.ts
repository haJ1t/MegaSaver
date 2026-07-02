import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextPackSchema } from "@megasaver/context-pruner";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import { buildIndex } from "@megasaver/indexer";
import { afterEach, describe, expect, it } from "vitest";
import { McpBridgeError } from "../../src/errors.js";
import { handleGetEditImpact } from "../../src/tools/get-edit-impact.js";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const TS = "2026-07-02T00:00:00.000Z";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeProject(repo: string) {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID as never,
    name: "demo",
    rootPath: repo,
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

describe("get_edit_impact", () => {
  it("returns impacted callers and suggested tests for explicit changedFiles", async () => {
    const store = mkdtempSync(join(tmpdir(), "edit-impact-store-"));
    const repo = mkdtempSync(join(tmpdir(), "edit-impact-repo-"));
    dirs.push(store, repo);
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "a.ts"), "export function alpha() {\n  return 1;\n}\n");
    writeFileSync(
      join(repo, "src", "b.ts"),
      'import { alpha } from "./a.js";\nexport function beta() {\n  return alpha();\n}\n',
    );
    writeFileSync(
      join(repo, "src", "b.test.ts"),
      'import { beta } from "./b.js";\nexport function betaCheck() {\n  return beta();\n}\n',
    );
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID as never });
    const registry = makeProject(repo);

    const result = handleGetEditImpact(
      { registry, storeRoot: store },
      { projectId: PROJECT_ID, changedFiles: ["src/a.ts"] },
    );

    expect(result.changedFiles).toEqual(["src/a.ts"]);
    expect(result.seeds).toEqual(["alpha"]);
    expect(contextPackSchema.safeParse(result.pack).success).toBe(true);
    expect(result.pack.task).toBe("edit-impact: alpha");
    const names = result.pack.included.map((b) => b.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
    expect(names).toContain("betaCheck");
    expect(result.suggestedTests).toEqual(["src/b.test.ts"]);
  });

  it("returns an empty result on a non-git root with no changedFiles", () => {
    const repo = mkdtempSync(join(tmpdir(), "edit-impact-nogit-"));
    dirs.push(repo);
    const registry = makeProject(repo);

    const result = handleGetEditImpact({ registry, storeRoot: repo }, { projectId: PROJECT_ID });

    expect(result.changedFiles).toEqual([]);
    expect(result.seeds).toEqual([]);
    expect(result.suggestedTests).toEqual([]);
    expect(result.pack.included).toEqual([]);
    expect(contextPackSchema.safeParse(result.pack).success).toBe(true);
  });

  it("caps seeds at 8 in deterministic block order", async () => {
    const store = mkdtempSync(join(tmpdir(), "edit-impact-cap-store-"));
    const repo = mkdtempSync(join(tmpdir(), "edit-impact-cap-repo-"));
    dirs.push(store, repo);
    mkdirSync(join(repo, "src"));
    const fns = Array.from(
      { length: 10 },
      (_, i) => `export function f${i}() {\n  return ${i};\n}`,
    );
    writeFileSync(join(repo, "src", "many.ts"), `${fns.join("\n")}\n`);
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID as never });
    const registry = makeProject(repo);

    const result = handleGetEditImpact(
      { registry, storeRoot: store },
      { projectId: PROJECT_ID, changedFiles: ["src/many.ts"] },
    );

    expect(result.seeds).toEqual(["f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7"]);
  });

  it("rejects a missing projectId", () => {
    const registry = createInMemoryCoreRegistry();
    expect(() => handleGetEditImpact({ registry, storeRoot: "/tmp" }, {})).toThrow(McpBridgeError);
  });

  it("rejects an unknown project", () => {
    const registry = createInMemoryCoreRegistry();
    expect(() =>
      handleGetEditImpact(
        { registry, storeRoot: "/tmp" },
        { projectId: "99999999-9999-4999-8999-999999999999" },
      ),
    ).toThrow(/project not found/);
  });
});
