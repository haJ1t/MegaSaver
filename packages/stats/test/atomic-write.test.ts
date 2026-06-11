import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWriteFile } from "../src/atomic-write.js";
import { StatsError } from "../src/errors.js";
import { describeUnlessWindows } from "./_platform.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-atomic-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("atomicWriteFile", () => {
  it("writes content to the target path", () => {
    const target = join(root, "a", "b", "file.json");
    atomicWriteFile(target, '{"ok":true}');
    expect(readFileSync(target, "utf8")).toBe('{"ok":true}');
  });

  it("creates missing parent directories", () => {
    const target = join(root, "deep", "nested", "dir", "file.json");
    atomicWriteFile(target, "x");
    expect(existsSync(target)).toBe(true);
  });

  it("leaves no temp files behind on success", () => {
    const dir = join(root, "clean");
    atomicWriteFile(join(dir, "file.json"), "x");
    const leftovers = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toHaveLength(0);
  });

  describeUnlessWindows("symlinked-parent guard (POSIX symlink semantics)", () => {
    it("rejects a symlinked parent directory with write_failed", () => {
      const realDir = join(root, "real");
      atomicWriteFile(join(realDir, "seed.json"), "x");
      const linkDir = join(root, "link");
      symlinkSync(realDir, linkDir);
      try {
        atomicWriteFile(join(linkDir, "file.json"), "y");
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(StatsError);
        expect((err as StatsError).code).toBe("write_failed");
      }
    });
  });
});
