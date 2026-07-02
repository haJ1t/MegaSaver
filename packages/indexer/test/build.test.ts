import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIndex } from "../src/build.js";
import { readBlocks, resolveIndexPaths } from "../src/store.js";

const PROJECT_ID = projectIdSchema.parse("00000000-0000-4000-8000-000000000001");

let repo: string;
let store: string;
let counter: number;

function newId(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "mega-repo-"));
  store = mkdtempSync(join(tmpdir(), "mega-store-"));
  counter = 0;
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "a.ts"), "export function a() { return 1; }\n");
  writeFileSync(join(repo, "src", "b.ts"), "export function b() { return 2; }\n");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(store, { recursive: true, force: true });
});

describe("buildIndex", () => {
  it("first build adds all blocks and persists blocks.jsonl + manifest.json", async () => {
    const result = await buildIndex({
      rootDir: repo,
      storeDir: store,
      projectId: PROJECT_ID,
      newId,
    });
    expect(result.added).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.blockCount).toBe(2);

    const paths = resolveIndexPaths(store, PROJECT_ID);
    expect(existsSync(paths.blocksPath)).toBe(true);
    expect(existsSync(paths.manifestPath)).toBe(true);
    expect(readBlocks(paths)).toHaveLength(2);
  });

  it("incremental rebuild only reprocesses the changed file", async () => {
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID, newId });
    writeFileSync(join(repo, "src", "a.ts"), "export function a() { return 99; }\n");
    const result = await buildIndex({
      rootDir: repo,
      storeDir: store,
      projectId: PROJECT_ID,
      newId,
    });
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(result.added).toBe(0);
    expect(result.blockCount).toBe(2);
  });

  it("removing a file drops its blocks on rebuild", async () => {
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID, newId });
    rmSync(join(repo, "src", "b.ts"));
    const result = await buildIndex({
      rootDir: repo,
      storeDir: store,
      projectId: PROJECT_ID,
      newId,
    });
    expect(result.removed).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(result.blockCount).toBe(1);
    expect(readBlocks(resolveIndexPaths(store, PROJECT_ID)).map((b) => b.filePath)).toEqual([
      "src/a.ts",
    ]);
  });

  it("tracks a zero-block file and reports it unchanged on rebuild", async () => {
    writeFileSync(join(repo, "plain.md"), "just prose, no headings\n");
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID, newId });
    const second = await buildIndex({
      rootDir: repo,
      storeDir: store,
      projectId: PROJECT_ID,
      newId,
    });
    expect(second.unchanged).toBe(3);
    expect(second.added).toBe(0);
  });

  it("derives calledBy across the indexed set (second pass)", async () => {
    writeFileSync(
      join(repo, "src", "c.ts"),
      "export function caller() {\n  return target();\n}\nexport function target() {\n  return 1;\n}\n",
    );
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID, newId });
    const target = readBlocks(resolveIndexPaths(store, PROJECT_ID)).find(
      (b) => b.name === "target",
    );
    expect(target?.calledBy).toContain("caller");
  });

  it("self-heals a corrupt blocks.jsonl by re-extracting on rebuild", async () => {
    await buildIndex({ rootDir: repo, storeDir: store, projectId: PROJECT_ID, newId });
    const paths = resolveIndexPaths(store, PROJECT_ID);
    writeFileSync(paths.blocksPath, "{ not valid json\n");
    const result = await buildIndex({
      rootDir: repo,
      storeDir: store,
      projectId: PROJECT_ID,
      newId,
    });
    expect(result.blockCount).toBe(2);
    expect(readBlocks(paths)).toHaveLength(2);
  });
});
