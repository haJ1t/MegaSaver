import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ReadIndexEntry, hashPath, loadReadIndex } from "../src/index.js";

describe("core re-exports the read-index surface (M6)", () => {
  it("exposes hashPath and loadReadIndex as functions", () => {
    expect(typeof hashPath).toBe("function");
    expect(typeof loadReadIndex).toBe("function");
    expect(hashPath("/work/a.ts")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("loadReadIndex reads a session dir and degrades to {} when absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "megasaver-core-readindex-"));
    try {
      expect(loadReadIndex(join(dir, "missing"))).toEqual({});
      const entry: ReadIndexEntry = { contentHash: "c".repeat(64), chunkSetId: "cs-1" };
      writeFileSync(join(dir, "read-index.json"), JSON.stringify({ [hashPath("/work/a.ts")]: entry }));
      expect(loadReadIndex(dir)[hashPath("/work/a.ts")]).toEqual(entry);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
