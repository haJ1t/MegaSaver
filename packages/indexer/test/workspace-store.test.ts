import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type WorkspaceKey, workspaceKeySchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CodeBlock } from "../src/code-block.js";
import { readBlocks, writeIndex } from "../src/store.js";
import { resolveWorkspaceIndexPaths } from "../src/workspace-store.js";

const KEY = workspaceKeySchema.parse("0123456789abcdef") as WorkspaceKey;
const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

let store: string;

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-wstore-"));
});

afterEach(() => {
  rmSync(store, { recursive: true, force: true });
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
