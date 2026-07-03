import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type LockOwner,
  type ProcessIdentityAdapter,
  nodeProcessIdentity,
  releaseLock,
  tryAcquireLock,
} from "./locks.js";

// The single transition slot in control.json is a shared, mutable resource:
// `mega proxy start`/`stop`, the GUI toggle, and the supervisor all read-modify-
// write it. Guarding every writer with this fenced lock turns those into a
// serialized critical section, so a concurrent writer can neither lose an update
// nor silently overwrite an in-flight transition. A live holder makes the lock
// unavailable ("locked"); a stale holder is reclaimed by the lock layer.
export function transitionLockPath(storeRoot: string): string {
  return join(storeRoot, "proxy", "transition.lock");
}

export type TransitionLockResult<T> = { status: "ok"; value: T } | { status: "locked" };

const LEASE_MS = 15_000;

export function withTransitionLock<T>(
  storeRoot: string,
  now: number,
  operation: string,
  fn: () => T,
  identity: ProcessIdentityAdapter = nodeProcessIdentity,
): TransitionLockResult<T> {
  const path = transitionLockPath(storeRoot);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const self = identity.self();
  const fenceToken = randomUUID();
  const owner: LockOwner = {
    ownerKind: "offline_cli",
    pid: self.pid,
    processStartToken: self.processStartToken,
    bootId: self.bootId,
    instanceId: fenceToken,
    fenceToken,
    operation,
    acquiredAt: new Date(now).toISOString(),
    leaseExpiresAt: new Date(now + LEASE_MS).toISOString(),
  };
  if (!tryAcquireLock(path, owner, identity, now)) return { status: "locked" };
  try {
    return { status: "ok", value: fn() };
  } finally {
    releaseLock(path, owner);
  }
}
