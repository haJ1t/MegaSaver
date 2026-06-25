import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { filterRaw, readAndFilter, readRaw } from "../src/read.js";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cg-read-split-"));
  file = join(dir, "a.txt");
  await writeFile(file, "line one\nerror: boom\nline three\n");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readRaw (C3)", () => {
  it("returns ok+raw for an existing file", async () => {
    const r = await readRaw(file);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.raw).toContain("error: boom");
  });

  it("returns ok:false+message for a missing file", async () => {
    const r = await readRaw(join(dir, "nope.txt"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message.length).toBeGreaterThan(0);
  });
});

describe("filterRaw (C3)", () => {
  it("produces a FilterOutputResult from raw text", async () => {
    const result = await filterRaw({
      raw: "line one\nerror: boom\nline three\n",
      path: file,
      intent: "find the error",
      mode: "balanced",
      maxReturnedBytes: 12_000,
    });
    expect(typeof result.summary).toBe("string");
    expect(Array.isArray(result.excerpts)).toBe(true);
    expect(result.rawBytes).toBeGreaterThan(0);
  });
});

describe("readAndFilter wrapper still works (C3 regression)", () => {
  it("returns ok+raw+result for an existing file", async () => {
    const r = await readAndFilter({
      absolute: file,
      path: file,
      intent: "find the error",
      mode: "balanced",
      maxReturnedBytes: 12_000,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.raw).toContain("error: boom");
      expect(typeof r.result.summary).toBe("string");
    }
  });

  it("propagates a read error", async () => {
    const r = await readAndFilter({
      absolute: join(dir, "missing.txt"),
      path: "missing.txt",
      intent: "x",
      mode: "balanced",
      maxReturnedBytes: undefined,
    });
    expect(r.ok).toBe(false);
  });
});
