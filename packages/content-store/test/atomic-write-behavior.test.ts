import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { atomicWriteFile } from "../src/atomic-write.js";
import { describeUnlessWindows } from "./_platform.js";

// A single hoisted mock intercepts rename(2) so a test can inject a fault at
// the exact rename boundary (scenario 2) without touching the production
// source. `failNextRename` stays false except while a test arms it.
const renameControl = vi.hoisted(() => ({ failNextRename: false }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: (
      oldPath: Parameters<typeof actual.renameSync>[0],
      newPath: Parameters<typeof actual.renameSync>[1],
    ) => {
      if (renameControl.failNextRename) {
        renameControl.failNextRename = false;
        throw Object.assign(new Error("EIO: injected rename fault"), { code: "EIO" });
      }
      return actual.renameSync(oldPath, newPath);
    },
  };
});

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "atomic-write-"));
  renameControl.failNextRename = false;
});

afterEach(() => {
  renameControl.failNextRename = false;
  rmSync(workdir, { recursive: true, force: true });
});

function leftoverTempFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".tmp"));
}

describe("atomicWriteFile behaviour", () => {
  it("scenario 1 — success: exact bytes written, no leftover tmp", () => {
    const dir = join(workdir, "cs");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "out.json");
    atomicWriteFile(file, '{"ok":true}\n');
    expect(readFileSync(file, "utf8")).toBe('{"ok":true}\n');
    expect(leftoverTempFiles(dir)).toEqual([]);
  });

  it("scenario 2 — crash-during-rename: original intact, no partial final, temp cleaned", () => {
    const dir = join(workdir, "cs-rename-fault");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "out.json");
    writeFileSync(file, "ORIGINAL");

    renameControl.failNextRename = true;
    expect(() => atomicWriteFile(file, "REPLACEMENT")).toThrow();
    expect(renameControl.failNextRename).toBe(false); // fault was actually exercised
    expect(readFileSync(file, "utf8")).toBe("ORIGINAL");
    expect(leftoverTempFiles(dir)).toEqual([]);
  });

  it("scenario 3 — crash-after-rename: final present and complete, no leftover tmp", () => {
    const dir = join(workdir, "cs-post-rename");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "out.json");
    writeFileSync(file, "ORIGINAL");

    atomicWriteFile(file, '{"replaced":true}\n');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe('{"replaced":true}\n');
    expect(leftoverTempFiles(dir)).toEqual([]);
  });

  describeUnlessWindows("symlinked-parent guard (POSIX symlink semantics)", () => {
    it("scenario 4 — dir-symlink-attack: refuses to write through a symlinked parent", () => {
      const realDir = join(workdir, "real");
      mkdirSync(realDir, { recursive: true });
      const linkDir = join(workdir, "link");
      symlinkSync(realDir, linkDir, "dir");

      expect(() => atomicWriteFile(join(linkDir, "out.json"), "x")).toThrow();
    });
  });

  it("scenario 5 — parent doesn't exist: creates it recursively then writes", () => {
    const file = join(workdir, "cs", "nested", "deep", "out.json");
    atomicWriteFile(file, "data");
    expect(readFileSync(file, "utf8")).toBe("data");
  });
});
