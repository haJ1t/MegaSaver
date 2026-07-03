import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type LockOwner,
  type ProcessIdentityAdapter,
  isOwnerStale,
  readLockOwner,
  tryAcquireLock,
} from "../src/locks.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mega-locks-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const BOOT = "boot-A";
// A fake process adapter: `alive` records which (pid,startToken) tuples are live.
function fakeIdentity(
  self: { pid: number; startToken: string },
  alive: Array<[number, string]> = [[self.pid, self.startToken]],
): ProcessIdentityAdapter {
  return {
    self: () => ({ pid: self.pid, processStartToken: self.startToken, bootId: BOOT }),
    isLiveSameBoot: (pid, startToken, bootId) =>
      bootId === BOOT && alive.some(([p, s]) => p === pid && s === startToken),
  };
}

const owner = (over: Partial<LockOwner> = {}): LockOwner => ({
  ownerKind: "offline_cli",
  pid: 100,
  processStartToken: "tokA",
  bootId: BOOT,
  instanceId: "inst",
  fenceToken: "f1",
  operation: "enable",
  acquiredAt: "2026-07-03T00:00:00.000Z",
  leaseExpiresAt: "2026-07-03T00:00:30.000Z",
  ...over,
});

const NOW = Date.UTC(2026, 6, 3, 0, 0, 10); // within the lease window

describe("isOwnerStale (offline_cli)", () => {
  const id = fakeIdentity({ pid: 100, startToken: "tokA" });

  it("a live same-boot owner with an unexpired lease is NOT stale", () => {
    expect(isOwnerStale(owner(), NOW, id)).toBe(false);
  });

  it("PID reuse with a different start token is stale (no permanent veto)", () => {
    // pid 100 is alive but under a DIFFERENT start token → the owner is stale.
    const idReused = fakeIdentity({ pid: 999, startToken: "tokZ" }, [[100, "tokDIFFERENT"]]);
    expect(isOwnerStale(owner(), NOW, idReused)).toBe(true);
  });

  it("a prior-boot owner is stale", () => {
    expect(isOwnerStale(owner({ bootId: "boot-OLD" }), NOW, id)).toBe(true);
  });

  it("an expired lease is stale even if the process is live", () => {
    const expired = Date.UTC(2026, 6, 3, 0, 1, 0); // past leaseExpiresAt
    expect(isOwnerStale(owner(), expired, id)).toBe(true);
  });

  it("a missing process (not in the alive set) is stale", () => {
    const idDead = fakeIdentity({ pid: 5, startToken: "tokE" }, []);
    expect(isOwnerStale(owner(), NOW, idDead)).toBe(true);
  });
});

describe("tryAcquireLock", () => {
  const id = fakeIdentity({ pid: 100, startToken: "tokA" });
  const lock = () => join(dir, "transition.lock");

  it("acquires a free lock and writes the owner record", () => {
    const got = tryAcquireLock(lock(), owner(), id, NOW);
    expect(got).toBe(true);
    expect(readLockOwner(lock())?.instanceId).toBe("inst");
  });

  it("fails to acquire when a LIVE owner holds it", () => {
    tryAcquireLock(lock(), owner({ instanceId: "held" }), id, NOW);
    const got = tryAcquireLock(lock(), owner({ instanceId: "contender" }), id, NOW);
    expect(got).toBe(false);
    expect(readLockOwner(lock())?.instanceId).toBe("held");
  });

  it("reclaims a STALE lock (dead/prior-boot owner) and takes ownership", () => {
    // Plant a stale owner (prior boot).
    writeFileSync(lock(), JSON.stringify(owner({ instanceId: "dead", bootId: "boot-OLD" })));
    const got = tryAcquireLock(lock(), owner({ instanceId: "fresh" }), id, NOW);
    expect(got).toBe(true);
    expect(readLockOwner(lock())?.instanceId).toBe("fresh");
  });

  it("a corrupt lock file is treated as stale and reclaimable", () => {
    writeFileSync(lock(), "{garbage");
    expect(tryAcquireLock(lock(), owner({ instanceId: "fresh" }), id, NOW)).toBe(true);
    expect(readLockOwner(lock())?.instanceId).toBe("fresh");
  });
});
