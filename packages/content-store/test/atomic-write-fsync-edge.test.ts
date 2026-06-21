import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Make ONLY the parent-directory fsync fail (identified by the fd being a
// directory), leaving every other fs call real. Scoped to this file.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    fsyncSync: (fd: number) => {
      if (actual.fstatSync(fd).isDirectory()) {
        throw Object.assign(new Error("injected dir fsync failure"), { code: "EIO" });
      }
      return actual.fsyncSync(fd);
    },
  };
});

const { atomicWriteFile } = await import("../src/atomic-write.js");

const itPosix = process.platform === "win32" ? it.skip : it;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "content-store-fsync-edge-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("atomicWriteFile — post-rename dir-fsync failure", () => {
  itPosix("reports success when the parent-dir fsync fails after rename", () => {
    const path = join(root, "committed.json");
    expect(() => atomicWriteFile(path, "payload\n")).not.toThrow();
    expect(readFileSync(path, "utf8")).toBe("payload\n");
  });
});
