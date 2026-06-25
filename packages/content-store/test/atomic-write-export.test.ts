import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWriteFile } from "../src/index.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cs-atomic-export-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("atomicWriteFile public export (C1b)", () => {
  it("is exported from the package entry and writes content atomically", () => {
    expect(typeof atomicWriteFile).toBe("function");
    const target = join(dir, "out.json");
    atomicWriteFile(target, '{"a":1}\n');
    expect(readFileSync(target, "utf8")).toBe('{"a":1}\n');
  });

  it("leaves no leftover .tmp files after a successful write", () => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    atomicWriteFile(join(dir, "x.json"), "hi");
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toHaveLength(0);
  });
});
