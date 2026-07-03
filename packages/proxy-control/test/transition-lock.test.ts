import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type LockOwner, type ProcessIdentityAdapter, tryAcquireLock } from "../src/locks.js";
import { transitionLockPath, withTransitionLock } from "../src/transition-lock.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "mega-txn-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

const NOW = Date.UTC(2026, 6, 3);

// An identity under which every recorded owner looks alive on this boot.
const liveIdentity: ProcessIdentityAdapter = {
  self: () => ({ pid: 4242, processStartToken: "tok", bootId: "boot" }),
  isLiveSameBoot: () => true,
};

describe("withTransitionLock", () => {
  it("runs the critical section under the lock and releases it afterwards", () => {
    let ran = false;
    const r = withTransitionLock(store, NOW, "start", () => {
      ran = true;
      return 7;
    });
    expect(ran).toBe(true);
    expect(r).toEqual({ status: "ok", value: 7 });
    expect(existsSync(transitionLockPath(store))).toBe(false); // released
  });

  it("returns locked and does NOT run when a live owner already holds the lock", () => {
    const heldBy: LockOwner = {
      ownerKind: "supervisor",
      pid: 4242,
      processStartToken: "tok",
      bootId: "boot",
      instanceId: "sup",
      fenceToken: "held",
      operation: "supervisor",
      acquiredAt: new Date(NOW).toISOString(),
      leaseExpiresAt: new Date(NOW + 60_000).toISOString(),
    };
    // A live supervisor holds the transition lock.
    mkdirSync(dirname(transitionLockPath(store)), { recursive: true });
    expect(tryAcquireLock(transitionLockPath(store), heldBy, liveIdentity, NOW)).toBe(true);

    let ran = false;
    const r = withTransitionLock(
      store,
      NOW,
      "stop",
      () => {
        ran = true;
        return 1;
      },
      liveIdentity,
    );
    expect(ran).toBe(false); // never entered the critical section
    expect(r).toEqual({ status: "locked" });
  });
});
