import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readJsonFile, writeJsonAtomic } from "../src/json-store.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-json-store-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readJsonFile", () => {
  it("returns undefined for a missing file", () => {
    expect(readJsonFile(join(root, "nope.json"))).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    const path = join(root, "bad.json");
    writeFileSync(path, "{ not json");
    expect(readJsonFile(path)).toBeUndefined();
  });

  it("returns undefined when the path is a directory", () => {
    expect(readJsonFile(root)).toBeUndefined();
  });

  it("returns the parsed value for valid JSON", () => {
    const path = join(root, "ok.json");
    writeFileSync(path, JSON.stringify({ a: 1, b: ["x"] }));
    expect(readJsonFile(path)).toEqual({ a: 1, b: ["x"] });
  });
});

describe("writeJsonAtomic", () => {
  it("creates a missing directory and writes the file", () => {
    const dir = join(root, "nested", "deep");
    writeJsonAtomic(dir, "state.json", { hello: "world" });
    expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8"))).toEqual({ hello: "world" });
  });

  it("leaves no .tmp file behind on success", () => {
    writeJsonAtomic(root, "state.json", { x: 1 });
    const leftover = readdirSync(root).filter((name) => name.endsWith(".tmp"));
    expect(leftover).toEqual([]);
  });

  it("overwrites an existing file", () => {
    writeJsonAtomic(root, "state.json", { v: 1 });
    writeJsonAtomic(root, "state.json", { v: 2 });
    expect(JSON.parse(readFileSync(join(root, "state.json"), "utf8"))).toEqual({ v: 2 });
  });

  it("swallows a write failure instead of throwing", () => {
    // A regular file where the store directory is expected: mkdirSync recursive
    // throws ENOTDIR/EEXIST, which the helper must absorb (advisory contract).
    const blocker = join(root, "blocker");
    writeFileSync(blocker, "i am a file");
    expect(() => writeJsonAtomic(join(blocker, "sub"), "state.json", { x: 1 })).not.toThrow();
  });
});
