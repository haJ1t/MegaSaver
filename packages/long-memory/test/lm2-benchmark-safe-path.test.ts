import { lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeSafeBenchmarkPath,
  openSafeBenchmarkPath,
  verifySafeBenchmarkPath,
} from "../src/lm2-benchmark-safe-path.js";

const roots: string[] = [];

afterEach(() => {
  vi.doUnmock("node:fs");
  vi.resetModules();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("LM2 benchmark safe paths", () => {
  it("uses a directory handle when Windows cannot open a directory descriptor", () => {
    const root = mkdtempSync(join(tmpdir(), "megasaver-lm2-safe-path-"));
    roots.push(root);
    const directory = join(root, "cache");
    mkdirSync(directory, { mode: 0o700 });

    const safe = openSafeBenchmarkPath(directory, "directory", "win32");
    try {
      expect(safe.descriptor).toBeNull();
      expect(safe.directory).not.toBeNull();
      expect(() => verifySafeBenchmarkPath(safe, "directory", "win32")).not.toThrow();
    } finally {
      closeSafeBenchmarkPath(safe);
    }
  });

  it("rejects a Windows directory pathname replacement after opening its handle", () => {
    const root = mkdtempSync(join(tmpdir(), "megasaver-lm2-safe-path-"));
    roots.push(root);
    const directory = join(root, "cache");
    mkdirSync(directory, { mode: 0o700 });
    const safe = openSafeBenchmarkPath(directory, "directory", "win32");
    try {
      renameSync(directory, `${directory}.displaced`);
      mkdirSync(directory, { mode: 0o700 });
      expect(() => verifySafeBenchmarkPath(safe, "directory", "win32")).toThrow();
    } finally {
      closeSafeBenchmarkPath(safe);
    }
  });

  it("rejects replacement between Windows identity capture and directory opening", async () => {
    const root = mkdtempSync(join(tmpdir(), "megasaver-lm2-safe-path-"));
    roots.push(root);
    const directory = join(root, "cache");
    mkdirSync(directory, { mode: 0o700 });
    const originalStats = lstatSync(directory);
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    let replaced = false;
    vi.doMock("node:fs", () => ({
      ...actual,
      opendirSync(...args: Parameters<typeof actual.opendirSync>) {
        const opened = actual.opendirSync(...args);
        renameSync(directory, `${directory}.displaced`);
        mkdirSync(directory, { mode: 0o700 });
        replaced = true;
        return opened;
      },
      lstatSync: ((...args: Parameters<typeof actual.lstatSync>) => {
        const options = args[1];
        const bigInt = typeof options === "object" && options !== null && options.bigint === true;
        if (replaced && !bigInt && String(args[0]) === directory) return originalStats;
        return actual.lstatSync(...args);
      }) as typeof actual.lstatSync,
    }));
    const safePath = await import("../src/lm2-benchmark-safe-path.js");

    expect(() => safePath.openSafeBenchmarkPath(directory, "directory", "win32")).toThrow();
  });
});
