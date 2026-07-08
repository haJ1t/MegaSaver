import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Inject a failure into ONE fs syscall at a time, keyed by a hoisted flag, and
// leave every other fs operation real. Mirrors content-store's fsync-edge test.
const state = vi.hoisted(() => ({ fail: "none" as "none" | "rename" | "dirfsync" }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: (from: string, to: string) => {
      if (state.fail === "rename") {
        throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
      }
      return actual.renameSync(from, to);
    },
    fsyncSync: (fd: number) => {
      if (state.fail === "dirfsync" && actual.fstatSync(fd).isDirectory()) {
        throw Object.assign(new Error("injected dir fsync failure"), { code: "EIO" });
      }
      return actual.fsyncSync(fd);
    },
  };
});

const { defaultCompressFs } = await import("../../src/commands/compress.js");

const itPosix = process.platform === "win32" ? it.skip : it;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-cmp-atomic-"));
  state.fail = "none";
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("defaultCompressFs writeFile — atomic temp+rename", () => {
  it("leaves the destination untouched when the rename fails", () => {
    const path = join(root, "CLAUDE.md");
    writeFileSync(path, "OLD");
    const { writeFile } = defaultCompressFs();
    state.fail = "rename";
    expect(() => writeFile(path, "NEW")).toThrow("injected rename failure");
    // Temp+rename means the destination is never written in place — still "OLD".
    // A plain writeFileSync(dest) would have truncated or replaced it.
    expect(readFileSync(path, "utf8")).toBe("OLD");
  });

  itPosix("commits the write even when the post-rename dir fsync fails", () => {
    const path = join(root, "CLAUDE.md");
    writeFileSync(path, "OLD");
    const { writeFile } = defaultCompressFs();
    state.fail = "dirfsync";
    // The parent-dir fsync is a durability hint after the rename already
    // committed; a failure there must not fail the write.
    expect(() => writeFile(path, "NEW")).not.toThrow();
    expect(readFileSync(path, "utf8")).toBe("NEW");
  });
});

describe("defaultCompressFs backupFile — atomic temp+rename", () => {
  it("never creates the backup and keeps the source intact when the rename fails", () => {
    const src = join(root, "CLAUDE.md");
    const dest = join(root, "CLAUDE.md.bak");
    writeFileSync(src, "SOURCE");
    const { backupFile } = defaultCompressFs();
    state.fail = "rename";
    expect(() => backupFile(src, dest)).toThrow("injected rename failure");
    // Copy (not move): source is untouched, and the backup is never partially
    // created at its final path.
    expect(readFileSync(src, "utf8")).toBe("SOURCE");
    expect(readdirSync(root).includes("CLAUDE.md.bak")).toBe(false);
  });
});
