import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withFileLock } from "../src/file-lock.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mega-filelock-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const lockPath = () => join(dir, ".test.lock");
const OPTS = { deadlineMs: 10, staleMs: 5000 };

describe("withFileLock", () => {
  it("acquires, runs fn, returns true, and removes the lock file", () => {
    const fn = vi.fn();
    const ran = withFileLock(lockPath(), OPTS, fn);
    expect(ran).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
    expect(existsSync(lockPath())).toBe(false);
  });

  it("returns false and does not run fn when a FRESH lock is contended", () => {
    writeFileSync(lockPath(), ""); // mtime = now → fresh holder
    const fn = vi.fn();
    const ran = withFileLock(lockPath(), OPTS, fn);
    expect(ran).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(existsSync(lockPath())).toBe(true); // foreign lock untouched
  });

  it("steals a STALE lock (mtime older than staleMs) and runs fn", () => {
    writeFileSync(lockPath(), "");
    const old = new Date(Date.now() - 10_000); // 10s back > 5s staleMs
    utimesSync(lockPath(), old, old);
    const fn = vi.fn();
    const ran = withFileLock(lockPath(), OPTS, fn);
    expect(ran).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
    expect(existsSync(lockPath())).toBe(false);
  });

  it("propagates fn errors AFTER releasing the lock file", () => {
    expect(() =>
      withFileLock(lockPath(), OPTS, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(existsSync(lockPath())).toBe(false);
  });

  it("does NOT steal a lock whose mtime sits just inside the fresh window", () => {
    writeFileSync(lockPath(), "");
    // mtime 100ms newer than the stale threshold → fresh, so the recheck-based
    // steal must not fire. Guards the double-steal fix: a lock refreshed toward
    // NOW between observation and steal must survive, not be removed.
    // ponytail: the exact now-staleMs+1ms boundary is not deterministic against
    // a spinning deadline; a margin > deadlineMs pins the same decision.
    const opts = { deadlineMs: 5, staleMs: 5000 };
    const fresh = new Date(Date.now() - opts.staleMs + 100);
    utimesSync(lockPath(), fresh, fresh);
    const fn = vi.fn();
    const ran = withFileLock(lockPath(), opts, fn);
    expect(ran).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(existsSync(lockPath())).toBe(true);
  });
});
