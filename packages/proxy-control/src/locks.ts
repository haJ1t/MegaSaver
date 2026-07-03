import { execFileSync } from "node:child_process";
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { z } from "zod";

export type OwnerKind = "offline_cli" | "supervisor" | "recovery";

export const lockOwnerSchema = z.object({
  ownerKind: z.enum(["offline_cli", "supervisor", "recovery"]),
  pid: z.number().int(),
  processStartToken: z.string(),
  bootId: z.string(),
  instanceId: z.string(),
  fenceToken: z.string(),
  operation: z.string(),
  acquiredAt: z.string(),
  leaseExpiresAt: z.string(),
});
export type LockOwner = z.infer<typeof lockOwnerSchema>;

export type ProcessIdentity = { pid: number; processStartToken: string; bootId: string };

// Injected so tests never depend on real OS process state. `isLiveSameBoot`
// answers: on THIS boot, is a process with this pid AND this start token alive?
// The start token defeats PID reuse — a recycled pid running a different process
// has a different start token.
export type ProcessIdentityAdapter = {
  self(): ProcessIdentity;
  isLiveSameBoot(pid: number, processStartToken: string, bootId: string): boolean;
};

// A durable lease is authoritative for offline_cli owners; supervisor liveness is
// established separately via authenticated discovery (P4), so at the lock layer we
// only decide staleness from boot + process identity + lease. These are
// ALTERNATIVE staleness predicates (any one makes the owner stale) — never an AND
// — so a reused pid cannot create a permanent veto.
export function isOwnerStale(
  owner: LockOwner,
  now: number,
  identity: ProcessIdentityAdapter,
): boolean {
  const self = identity.self();
  if (owner.bootId !== self.bootId) return true; // prior boot
  if (Date.parse(owner.leaseExpiresAt) <= now) return true; // expired lease
  if (!identity.isLiveSameBoot(owner.pid, owner.processStartToken, owner.bootId)) return true;
  return false;
}

export function readLockOwner(path: string): LockOwner | null {
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(path);
  } catch {
    return null;
  }
  if (st.isSymbolicLink() || !st.isFile()) return null;
  try {
    const parsed = lockOwnerSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// wx-create the lock (exclusive). If it already exists, acquire only when the
// current owner is stale/corrupt — reclaimed by quarantine-then-recreate so two
// contenders never both win. A live owner keeps the lock.
export function tryAcquireLock(
  path: string,
  owner: LockOwner,
  identity: ProcessIdentityAdapter,
  now: number,
): boolean {
  if (create(path, owner)) return true;
  const current = readLockOwner(path);
  if (current !== null && !isOwnerStale(current, now, identity)) return false; // live owner holds it
  // Stale or corrupt: quarantine (rename) then re-create. If the rename races
  // with another contender, one of them succeeds and the other retries.
  const quarantined = `${path}.stale.${owner.fenceToken}`;
  try {
    renameSync(path, quarantined);
  } catch {
    // Another contender already moved/removed it — retry the create.
    return create(path, owner);
  }
  try {
    rmSync(quarantined, { force: true });
  } catch {
    /* best-effort cleanup */
  }
  return create(path, owner);
}

function create(path: string, owner: LockOwner): boolean {
  try {
    const fd = openSync(path, "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(lockOwnerSchema.parse(owner)));
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

// Refresh the lease in place through a fresh open of the SAME path (the lock is
// never renamed for refresh, so its identity stays stable), extending
// leaseExpiresAt. Returns false if the lock is no longer ours.
export function refreshLease(
  path: string,
  owner: LockOwner,
  leaseMs: number,
  now: number,
): boolean {
  const current = readLockOwner(path);
  if (current === null || current.fenceToken !== owner.fenceToken) return false;
  const next: LockOwner = { ...current, leaseExpiresAt: new Date(now + leaseMs).toISOString() };
  writeFileSync(path, JSON.stringify(next), { mode: 0o600 });
  return true;
}

export function releaseLock(path: string, owner: LockOwner): void {
  const current = readLockOwner(path);
  if (current !== null && current.fenceToken === owner.fenceToken) {
    try {
      rmSync(path, { force: true });
    } catch {
      /* best-effort */
    }
  }
}

// Real OS process identity. bootId is the kernel boot time; the process start
// token is the process's own start time, so pid reuse across a restart yields a
// different token. Both are read via non-mutating platform tools; on failure we
// fall back to conservative values that make cross-run owners look stale.
export const nodeProcessIdentity: ProcessIdentityAdapter = {
  self() {
    return {
      pid: process.pid,
      processStartToken: processStartToken(process.pid),
      bootId: bootId(),
    };
  },
  isLiveSameBoot(pid, token, boot) {
    if (boot !== bootId()) return false;
    const current = processStartToken(pid);
    return current !== "" && current === token;
  },
};

function bootId(): string {
  try {
    if (process.platform === "darwin") {
      return execFileSync("sysctl", ["-n", "kern.boottime"], { encoding: "utf8" }).trim();
    }
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    return "unknown-boot";
  }
}

function processStartToken(pid: number): string {
  try {
    if (process.platform === "linux") {
      // field 22 of /proc/<pid>/stat is starttime in clock ticks — stable per process.
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const after = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      return after[19] ?? "";
    }
    // macOS/BSD: elapsed-since-start is stable enough for same-boot identity.
    return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}
