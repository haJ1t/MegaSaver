import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWriteFile } from "../src/atomic-write.js";
import { AgentOfficeError } from "../src/errors.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agent-office-aw-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("atomicWriteFile", () => {
  it("writes content, creating parent dirs", () => {
    const path = join(root, "a", "b", "file.json");
    atomicWriteFile(path, "hello\n");
    expect(readFileSync(path, "utf8")).toBe("hello\n");
  });

  it("overwrites existing content atomically", () => {
    const path = join(root, "file.json");
    atomicWriteFile(path, "one");
    atomicWriteFile(path, "two");
    expect(readFileSync(path, "utf8")).toBe("two");
  });

  it("rejects writing under a symlinked parent dir", () => {
    const realDir = join(root, "real");
    atomicWriteFile(join(realDir, "keep.json"), "x"); // creates realDir
    const linkDir = join(root, "link");
    symlinkSync(realDir, linkDir);
    expect(() => atomicWriteFile(join(linkDir, "f.json"), "y")).toThrow(AgentOfficeError);
  });
});
