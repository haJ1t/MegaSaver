import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hashContent,
  hashPath,
  loadReadIndex,
  readIndexPath,
  recordRead,
} from "../src/read-index.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cg-read-index-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("hashContent (T1)", () => {
  it("identical bytes hash equal; one-byte change differs", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
    expect(hashContent("abc")).not.toBe(hashContent("abd"));
    expect(hashContent(Buffer.from("abc"))).toBe(hashContent("abc"));
    expect(hashContent("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hashPath (T2)", () => {
  it("is stable, hex, and differs per path", () => {
    expect(hashPath("/a/b.txt")).toBe(hashPath("/a/b.txt"));
    expect(hashPath("/a/b.txt")).not.toBe(hashPath("/a/c.txt"));
    expect(hashPath("/a/b.txt")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the raw absolute path never appears in the index file on disk", async () => {
    const abs = "/secret/path/token=abc123.txt";
    recordRead(dir, hashPath(abs), { contentHash: hashContent("x"), chunkSetId: "cs-1" });
    const onDisk = await readFile(readIndexPath(dir), "utf8");
    expect(onDisk).not.toContain(abs);
    expect(onDisk).not.toContain("token=abc123");
  });
});

describe("loadReadIndex (T3, T4)", () => {
  it("missing dir -> {}", () => {
    expect(loadReadIndex(join(dir, "does-not-exist"))).toEqual({});
  });

  it("corrupt read-index.json -> {} (no throw)", async () => {
    await writeFile(readIndexPath(dir), "this is not json{{{");
    expect(loadReadIndex(dir)).toEqual({});
  });

  it("non-object json (array) -> {} (no throw)", async () => {
    await writeFile(readIndexPath(dir), "[1,2,3]");
    expect(loadReadIndex(dir)).toEqual({});
  });
});

describe("recordRead + reload (T5)", () => {
  it("round-trips the entry, leaves no tmp file, writes well-formed JSON", async () => {
    const key = hashPath("/x/y.txt");
    recordRead(dir, key, { contentHash: "deadbeef", chunkSetId: "cs-42" });
    const index = loadReadIndex(dir);
    expect(index[key]).toEqual({ contentHash: "deadbeef", chunkSetId: "cs-42" });

    const names = await readdir(dir);
    expect(names.filter((n) => n.endsWith(".tmp"))).toHaveLength(0);
    const onDisk = await readFile(readIndexPath(dir), "utf8");
    expect(() => JSON.parse(onDisk)).not.toThrow();
  });

  it("a second recordRead preserves the first key", () => {
    const k1 = hashPath("/a.txt");
    const k2 = hashPath("/b.txt");
    recordRead(dir, k1, { contentHash: "h1", chunkSetId: "c1" });
    recordRead(dir, k2, { contentHash: "h2", chunkSetId: "c2" });
    const index = loadReadIndex(dir);
    expect(index[k1]).toEqual({ contentHash: "h1", chunkSetId: "c1" });
    expect(index[k2]).toEqual({ contentHash: "h2", chunkSetId: "c2" });
  });
});
