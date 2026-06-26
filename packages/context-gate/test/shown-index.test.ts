import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashContent } from "../src/read-index.js";
import { loadShownIndex, recordShown, shownIndexPath } from "../src/shown-index.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cg-shown-index-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadShownIndex", () => {
  it("missing dir -> {}", () => {
    expect(loadShownIndex(join(dir, "does-not-exist"))).toEqual({});
  });
  it("corrupt json -> {} (no throw)", async () => {
    await writeFile(shownIndexPath(dir), "not json{{{");
    expect(loadShownIndex(dir)).toEqual({});
  });
  it("non-object json (array) -> {} (no throw)", async () => {
    await writeFile(shownIndexPath(dir), "[1,2,3]");
    expect(loadShownIndex(dir)).toEqual({});
  });
});

describe("recordShown + reload", () => {
  it("round-trips entries, leaves no tmp file, writes well-formed JSON", async () => {
    const h = hashContent("hello world");
    recordShown(dir, [{ textHash: h, chunkSetId: "cs-1" }]);
    const index = loadShownIndex(dir);
    expect(index[h]).toEqual({ chunkSetId: "cs-1" });
    const names = await readdir(dir);
    expect(names.filter((n) => n.endsWith(".tmp"))).toHaveLength(0);
    const onDisk = await readFile(shownIndexPath(dir), "utf8");
    expect(() => JSON.parse(onDisk)).not.toThrow();
  });
  it("records multiple entries in one call", () => {
    const h1 = hashContent("a");
    const h2 = hashContent("b");
    recordShown(dir, [
      { textHash: h1, chunkSetId: "cs-1" },
      { textHash: h2, chunkSetId: "cs-2" },
    ]);
    const index = loadShownIndex(dir);
    expect(index[h1]).toEqual({ chunkSetId: "cs-1" });
    expect(index[h2]).toEqual({ chunkSetId: "cs-2" });
  });
  it("is first-writer-wins: re-recording an existing textHash keeps the original chunkSetId", () => {
    const h = hashContent("dup");
    recordShown(dir, [{ textHash: h, chunkSetId: "cs-first" }]);
    recordShown(dir, [{ textHash: h, chunkSetId: "cs-second" }]);
    expect(loadShownIndex(dir)[h]).toEqual({ chunkSetId: "cs-first" });
  });
  it("swallows a write error (unwritable session dir) and does not throw", async () => {
    await chmod(dir, 0o500);
    expect(() =>
      recordShown(dir, [{ textHash: hashContent("x"), chunkSetId: "cs-1" }]),
    ).not.toThrow();
    await chmod(dir, 0o700);
  });
  it("empty entries is a no-op", () => {
    expect(() => recordShown(dir, [])).not.toThrow();
  });
});
