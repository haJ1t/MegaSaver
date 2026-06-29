import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readVectors, writeVectors } from "../src/store.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mega-embed-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("vector sidecar store", () => {
  it("round-trips entries write → read", () => {
    const path = join(dir, "vectors.jsonl");
    writeVectors(path, [
      { id: "a", vector: [0.1, 0.2, 0.3] },
      { id: "b", vector: [-1, 0, 1] },
    ]);
    const got = readVectors(path);
    expect(got.size).toBe(2);
    expect(Array.from(got.get("a") ?? [])).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.3),
    ]);
    expect(Array.from(got.get("b") ?? [])).toEqual([-1, 0, 1]);
  });

  it("returns Float32Array values", () => {
    const path = join(dir, "vectors.jsonl");
    writeVectors(path, [{ id: "a", vector: [1, 2] }]);
    expect(readVectors(path).get("a")).toBeInstanceOf(Float32Array);
  });

  it("writes one JSON record per line", () => {
    const path = join(dir, "vectors.jsonl");
    writeVectors(path, [
      { id: "a", vector: [1] },
      { id: "b", vector: [2] },
    ]);
    const lines = readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toEqual({ id: "a", vector: [1] });
  });

  it("missing file → empty map", () => {
    expect(readVectors(join(dir, "nope.jsonl")).size).toBe(0);
  });

  it("empty entries → empty file → empty map", () => {
    const path = join(dir, "vectors.jsonl");
    writeVectors(path, []);
    expect(readFileSync(path, "utf8")).toBe("");
    expect(readVectors(path).size).toBe(0);
  });
});
