import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type WorkspaceKey, projectIdSchema, workspaceKeySchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildWorkspaceIndex } from "../src/build.js";
import type { CodeBlock } from "../src/code-block.js";
import { readBlocks, writeIndex } from "../src/store.js";
import { resolveWorkspaceIndexPaths, workspaceProjectId } from "../src/workspace-store.js";

const KEY = workspaceKeySchema.parse("0123456789abcdef") as WorkspaceKey;
const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

let store: string;
let repo: string;

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-wstore-"));
  repo = mkdtempSync(join(tmpdir(), "mega-wrepo-"));
});

afterEach(() => {
  rmSync(store, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe("resolveWorkspaceIndexPaths", () => {
  it("resolves to <store>/index/<key>/{blocks.jsonl,manifest.json}", () => {
    const paths = resolveWorkspaceIndexPaths(store, KEY);
    expect(paths.indexDir).toBe(join(store, "index", KEY));
    expect(paths.blocksPath).toBe(join(store, "index", KEY, "blocks.jsonl"));
    expect(paths.manifestPath).toBe(join(store, "index", KEY, "manifest.json"));
  });

  it("round-trips a writeIndex through readBlocks", () => {
    const paths = resolveWorkspaceIndexPaths(store, KEY);
    const block: CodeBlock = {
      id: "00000000-0000-4000-8000-0000000000aa",
      projectId: PROJECT_ID,
      filePath: "src/a.ts",
      startLine: 1,
      endLine: 1,
      blockType: "function",
      name: "a",
      contentHash: "deadbeef",
      imports: [],
      exports: [],
      calls: [],
      calledBy: [],
      keywords: [],
      lastModifiedAt: "2026-06-14T00:00:00.000Z",
    } as unknown as CodeBlock;
    writeIndex(paths, [block], { files: {} });
    expect(readBlocks(paths)).toHaveLength(1);
    expect(readBlocks(paths)[0]?.name).toBe("a");
  });
});

describe("workspaceProjectId", () => {
  it("derives a lowercase UUID that projectIdSchema accepts", () => {
    const id = workspaceProjectId(KEY);
    expect(projectIdSchema.safeParse(id).success).toBe(true);
  });

  it("is stable for the same key", () => {
    expect(workspaceProjectId(KEY)).toBe(workspaceProjectId(KEY));
  });

  it("is a version-5 UUID (disjoint from random v4 projectIds)", () => {
    expect(workspaceProjectId(KEY)[14]).toBe("5");
  });

  it("differs for different keys", () => {
    const other = workspaceKeySchema.parse("fedcba9876543210") as WorkspaceKey;
    expect(workspaceProjectId(KEY)).not.toBe(workspaceProjectId(other));
  });
});

describe("buildWorkspaceIndex", () => {
  it("writes index/<key>/blocks.jsonl with workspaceProjectId blocks", () => {
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src", "a.ts"), "export function a() { return 1; }\n");
    const result = buildWorkspaceIndex({ rootDir: repo, storeDir: store, workspaceKey: KEY });
    expect(result.blockCount).toBeGreaterThan(0);

    const blocks = readBlocks(resolveWorkspaceIndexPaths(store, KEY));
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.projectId).toBe(workspaceProjectId(KEY));
    }
  });
});
