import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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

  // E25 regression. The steal used to be followed by an unconditional deadline
  // re-check, so a steal that SUCCEEDED still returned false when the four
  // syscalls it costs (open + stat + stat + rm) outran deadlineMs. The caller
  // then skipped its write having just cleared the only obstacle to it — and
  // the saver paths run this with deadlineMs 10 and 50, so a loaded machine hit
  // it routinely. Observed as `saver-heartbeat` E25 going red on CI ubuntu with
  // `expected {} to have property "aaaa"`.
  //
  // deadlineMs 0 pins the case deterministically: it is exactly "the deadline
  // was already gone by the time the steal finished", without racing the clock.
  it("steals a STALE lock even when the deadline elapsed during the steal", () => {
    writeFileSync(lockPath(), "");
    const old = new Date(Date.now() - 10_000);
    utimesSync(lockPath(), old, old);
    const fn = vi.fn();
    const ran = withFileLock(lockPath(), { deadlineMs: 0, staleMs: 5000 }, fn);
    expect(ran).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
    expect(existsSync(lockPath())).toBe(false);
  });

  it("returns false (does not hang) when a stale lock cannot be removed", () => {
    // A directory at the lock path reads as a stale holder (old mtime), but
    // rmSync (non-recursive) throws EISDIR — the steal can never succeed.
    // Without a deadline check in the steal branch this loops forever.
    mkdirSync(lockPath());
    const old = new Date(Date.now() - 10_000);
    utimesSync(lockPath(), old, old);
    const fn = vi.fn();
    const ran = withFileLock(lockPath(), OPTS, fn);
    expect(ran).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  }, 5000);

  // The failure mode OPPOSITE to the abandoned-steal bug, and the worse one:
  // removing a lock that is not actually dead lets two processes into fn() at
  // once — a lost update, where a skipped write is merely a gap. The steal path
  // now retries past the deadline, so this pins the invariant with real
  // processes rather than trusting the re-stat gate by reading it.
  //
  // Each worker appends a marker on enter and on exit. If mutual exclusion
  // holds, the file reads as well-formed pairs (enter-N, exit-N) and never
  // interleaves two enters.
  it("never lets two processes into fn() at once, even with steals in play", async () => {
    const lock = lockPath();
    const journal = join(dir, "journal.log");
    writeFileSync(journal, "");
    const worker = join(dir, "w.mjs");
    writeFileSync(
      worker,
      `
import { appendFileSync } from "node:fs";
const [, , modUrl, lock, journal, id] = process.argv;
const { withFileLock } = await import(modUrl);
for (let i = 0; i < 40; i++) {
  withFileLock(lock, { deadlineMs: 50, staleMs: 5000 }, () => {
    appendFileSync(journal, \`enter-\${id}\\n\`);
    // Hold it long enough that a concurrent entrant would overlap.
    const until = Date.now() + 2;
    while (Date.now() < until) { /* spin */ }
    appendFileSync(journal, \`exit-\${id}\\n\`);
  });
}
`,
    );
    const modUrl = pathToFileURL(resolve(import.meta.dirname, "../src/file-lock.ts")).href;
    await Promise.all(
      ["a", "b", "c"].map(
        (id) =>
          new Promise<void>((ok, fail) => {
            const child = spawn(process.execPath, [worker, modUrl, lock, journal, id], {
              stdio: ["ignore", "ignore", "pipe"],
            });
            let err = "";
            child.stderr.on("data", (c) => {
              err += String(c);
            });
            child.on("exit", (code) => (code === 0 ? ok() : fail(new Error(err))));
          }),
      ),
    );

    const lines = readFileSync(journal, "utf8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(20); // not a vacuous pass: work happened
    const overlaps = lines.filter(
      (line, i) => line.startsWith("enter-") && lines[i + 1]?.startsWith("enter-"),
    );
    expect(overlaps).toEqual([]);
  }, 60_000);

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
