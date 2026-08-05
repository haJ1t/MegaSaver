import { constants, type Stats } from "node:fs";
import { lstat, open, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";
import { prepareCapsuleDirectory } from "./cache-advice-migration-capsule.js";
import {
  cacheAdviceMigrationComplete,
  writeMigrationJournal,
} from "./cache-advice-migration-journal.js";
import {
  type PrivateFileIdentity,
  effectivePosixUserId,
  hasErrorCode,
  privateFileSnapshot,
  pruneExpiredPrivateFile,
  readBoundedPrivateFile,
  replacePrivateFile,
  requirePrivateRegularFile,
  samePrivateFileIdentity,
  unlinkOwnedFile,
} from "./cache-advice-private-node.js";
import {
  cacheAdviceRecordId,
  compactCacheAdviceQueue,
  enqueueCacheAdviceRecord,
} from "./cache-advice-queue.js";
import {
  prepareCacheAdviceV3Directory,
  prepareTaskKickoffStoreRootDirectory,
  resolveTaskKickoffStoreDependencies,
} from "./task-kickoff-store-fs.js";

export type MaintainCacheAdviceResult = "complete" | "incomplete" | "suppressed";

export { cacheAdviceMigrationComplete } from "./cache-advice-migration-journal.js";

const MAX_CACHE_ADVICE_STATE_BYTES = 32_768;
const OVERLAY_RETENTION_MS = 30 * 86_400_000;
const DIRECTORY_KEY = /^[0-9a-f]{64}$/;
const SESSION_STORAGE_KEY = /^[a-z2-7]{26}$/;
const STRICT_TRANSACTION_TEMP =
  /^\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;

const callSchema = z
  .object({
    tool: z.enum(["Read", "Grep", "Glob"]),
    directoryKey: z.string().regex(DIRECTORY_KEY),
    at: z.number().finite(),
  })
  .strict();
const legacyStateSchema = z
  .object({
    version: z.literal(2),
    offeredDirectoryKeys: z.array(z.string().regex(DIRECTORY_KEY)).max(64),
    recent: z.array(callSchema).max(128),
  })
  .strict();

type MigrationLock = {
  handle: Awaited<ReturnType<typeof open>>;
  identity: PrivateFileIdentity;
};

async function createMigrationLock(root: string, uid: number): Promise<MigrationLock | null> {
  const path = join(root, ".migration.lock");
  let handle: Awaited<ReturnType<typeof open>>;
  let identity: PrivateFileIdentity | undefined;
  try {
    handle = await open(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600,
    );
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) return null;
    throw error;
  }
  try {
    await handle.chmod(0o600);
    identity = requirePrivateRegularFile(await handle.stat(), uid);
    await handle.sync();
    await resolveTaskKickoffStoreDependencies().syncDirectory(root);
    return { handle, identity };
  } catch (error) {
    try {
      await handle.close();
    } catch {
      // Preserve the lock acquisition failure.
    }
    if (identity !== undefined) await unlinkOwnedFile(path, identity, uid);
    throw error;
  }
}

// No-wait under contention, but a stale lock abandoned by a crashed worker is
// reclaimed through the same 30-day expiry decision as the GC lock: a future
// timestamp is normalized, only a strictly-expired lock is unlinked, and a
// live lock makes this pass a safe no-op.
async function acquireMigrationLock(
  root: string,
  cutoffMs: number,
  at: number,
  uid: number,
): Promise<MigrationLock | null> {
  const path = join(root, ".migration.lock");
  const live = await privateFileSnapshot(path, uid);
  if (live !== undefined && live.mtimeMs >= cutoffMs && live.mtimeMs <= at) return null;
  const created = await createMigrationLock(root, uid);
  if (created !== null) return created;
  if ((await pruneExpiredPrivateFile(path, cutoffMs, at, uid)) !== "removed") return null;
  return createMigrationLock(root, uid);
}

async function releaseMigrationLock(
  root: string,
  lock: MigrationLock,
  uid: number,
): Promise<boolean> {
  let released = true;
  try {
    await lock.handle.close();
  } catch {
    released = false;
  }
  if (!(await unlinkOwnedFile(join(root, ".migration.lock"), lock.identity, uid))) return false;
  try {
    await resolveTaskKickoffStoreDependencies().syncDirectory(root);
  } catch {
    return false;
  }
  return released;
}

// A valid strict v2 snapshot is FIFO-enrolled BEFORE it moves, then securely
// renamed into its capsule. An existing capsule state suppresses the move so
// the legacy node is never destroyed and the capsule never overwritten.
async function migrateValidV2State(input: {
  storeRoot: string;
  legacyDirectory: string;
  legacyPath: string;
  identity: PrivateFileIdentity;
  workspaceKey: string;
  sessionKey: string;
  uid: number;
}): Promise<boolean> {
  const recordId = cacheAdviceRecordId({
    workspaceKey: input.workspaceKey,
    sessionStorageKey: input.sessionKey,
  });
  const enrolled = await enqueueCacheAdviceRecord({
    storeRoot: input.storeRoot,
    recordId,
  });
  if (enrolled !== "enqueued") return false;
  const capsule = await prepareCapsuleDirectory(input.storeRoot, recordId, process.platform);
  if (capsule === undefined) return false;
  const destination = join(capsule, "state.json");
  if ((await privateFileSnapshot(destination, input.uid)) !== undefined) return false;
  const current = requirePrivateRegularFile(await lstat(input.legacyPath), input.uid);
  if (!samePrivateFileIdentity(current, input.identity)) return false;
  await rename(input.legacyPath, destination);
  await resolveTaskKickoffStoreDependencies().syncDirectory(capsule);
  await resolveTaskKickoffStoreDependencies().syncDirectory(input.legacyDirectory);
  return true;
}

// v1, malformed, oversized, and unknown-version state is never parsed or
// reset. An opaque expiry suppression capsule is written first, then only the
// exact trusted legacy node is removed by identity-checked unlink.
async function suppressLegacyState(input: {
  storeRoot: string;
  legacyDirectory: string;
  legacyPath: string;
  identity: PrivateFileIdentity;
  workspaceKey: string;
  sessionKey: string;
  uid: number;
}): Promise<boolean> {
  const recordId = cacheAdviceRecordId({
    workspaceKey: input.workspaceKey,
    sessionStorageKey: input.sessionKey,
  });
  const enrolled = await enqueueCacheAdviceRecord({
    storeRoot: input.storeRoot,
    recordId,
  });
  if (enrolled !== "enqueued") return false;
  const capsule = await prepareCapsuleDirectory(input.storeRoot, recordId, process.platform);
  if (capsule === undefined) return false;
  const suppression = `${JSON.stringify({ version: 1, kind: "suppression" })}\n`;
  await replacePrivateFile(capsule, join(capsule, "suppression.json"), suppression, input.uid);
  if (!(await unlinkOwnedFile(input.legacyPath, input.identity, input.uid))) return false;
  await resolveTaskKickoffStoreDependencies().syncDirectory(input.legacyDirectory);
  return true;
}

type LegacyNodeKind = "state" | "lock" | "temp" | "unknown";

function classifyLegacyNode(name: string): LegacyNodeKind {
  if (name.endsWith(".json") && SESSION_STORAGE_KEY.test(name.slice(0, -5))) return "state";
  if (name.endsWith(".lock") && SESSION_STORAGE_KEY.test(name.slice(0, -5))) return "lock";
  if (STRICT_TRANSACTION_TEMP.test(name)) return "temp";
  return "unknown";
}

// A state node that is a verified-private regular file but whose content is
// v1, malformed, oversized, or an unknown version is suppressed; a node that
// fails the private-descriptor check (symlink, hard link, non-private
// mode/owner, special file) is an unsafe known-shape node that blocks
// completion and is never followed or deleted.
async function sweepStateNode(input: {
  storeRoot: string;
  workspaceKey: string;
  directory: string;
  path: string;
  sessionKey: string;
  uid: number;
}): Promise<"clean" | "blocked"> {
  // Distinguish "verified-private regular file" from "unsafe node" without
  // ever following a symlink: lstat tells us the node type directly.
  let named: PrivateFileIdentity;
  try {
    named = requirePrivateRegularFile(await lstat(input.path), input.uid);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return "clean";
    return "blocked";
  }

  let parsed: { raw: string; identity: PrivateFileIdentity } | undefined;
  let oversized = false;
  try {
    const entry = await readBoundedPrivateFile(input.path, MAX_CACHE_ADVICE_STATE_BYTES, input.uid);
    if (entry !== undefined) parsed = { raw: entry.raw, identity: entry.identity };
  } catch (error) {
    // A verified-private regular file that merely exceeds the byte ceiling is
    // suppressed (its content is untrusted but its node is trusted); any other
    // read failure leaves the node fenced and blocks completion.
    if (error instanceof Error && error.message.includes("byte ceiling")) {
      oversized = true;
    }
    parsed = undefined;
  }
  if (parsed === undefined && !oversized) return "blocked";

  let migrated = false;
  if (parsed !== undefined) {
    try {
      legacyStateSchema.parse(JSON.parse(parsed.raw));
      migrated = await migrateValidV2State({
        storeRoot: input.storeRoot,
        legacyDirectory: input.directory,
        legacyPath: input.path,
        identity: parsed.identity,
        workspaceKey: input.workspaceKey,
        sessionKey: input.sessionKey,
        uid: input.uid,
      });
    } catch {
      migrated = false;
    }
  }
  if (migrated) return "clean";

  // Content failed strict v2 (v1, malformed, oversized, unknown version) or
  // the safe move could not commit. Confirm the node is unchanged, then write
  // an opaque suppression and remove only the exact trusted node.
  const latest = await privateFileSnapshot(input.path, input.uid);
  if (latest === undefined || !samePrivateFileIdentity(latest, named)) return "blocked";
  const suppressed = await suppressLegacyState({
    storeRoot: input.storeRoot,
    legacyDirectory: input.directory,
    legacyPath: input.path,
    identity: named,
    workspaceKey: input.workspaceKey,
    sessionKey: input.sessionKey,
    uid: input.uid,
  });
  return suppressed ? "clean" : "blocked";
}

// Descriptor-safe walk of one legacy flat directory. Known-shape unsafe nodes
// block completion; arbitrary unknown nodes are ignored forever and never
// block.
async function sweepLegacyDirectory(input: {
  storeRoot: string;
  workspaceKey: string;
  directory: string;
  cutoffMs: number;
  now: number;
  uid: number;
}): Promise<"clean" | "blocked"> {
  let directoryStats: Stats;
  try {
    directoryStats = await lstat(input.directory);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return "clean";
    return "blocked";
  }
  if (
    !directoryStats.isDirectory() ||
    directoryStats.isSymbolicLink() ||
    directoryStats.uid !== input.uid ||
    (directoryStats.mode & 0o077) !== 0
  ) {
    return "blocked";
  }
  let blocked = false;
  const entries = await readdir(input.directory);
  for (const name of entries) {
    const path = join(input.directory, name);
    const kind = classifyLegacyNode(name);
    if (kind === "unknown") continue;
    if (kind === "lock" || kind === "temp") {
      const outcome = await pruneExpiredPrivateFile(path, input.cutoffMs, input.now, input.uid);
      if (outcome === "unsafe") blocked = true;
      continue;
    }
    const outcome = await sweepStateNode({
      storeRoot: input.storeRoot,
      workspaceKey: input.workspaceKey,
      directory: input.directory,
      path,
      sessionKey: name.slice(0, -5),
      uid: input.uid,
    });
    if (outcome === "blocked") blocked = true;
  }
  return blocked ? "blocked" : "clean";
}

async function sweepAllLegacyTrees(input: {
  storeRoot: string;
  now: number;
  uid: number;
}): Promise<"clean" | "blocked"> {
  const statsDirectory = join(input.storeRoot, "stats");
  const cutoffMs = input.now - OVERLAY_RETENTION_MS;
  let blocked = false;
  let workspaceEntries: string[];
  try {
    const stats = await lstat(statsDirectory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) return "clean";
    workspaceEntries = await readdir(statsDirectory);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return "clean";
    return "blocked";
  }
  for (const workspaceKey of workspaceEntries) {
    if (!workspaceKeySchema.safeParse(workspaceKey).success) continue;
    const legacyDirectory = join(statsDirectory, workspaceKey, "cache-advice");
    const outcome = await sweepLegacyDirectory({
      storeRoot: input.storeRoot,
      workspaceKey,
      directory: legacyDirectory,
      cutoffMs,
      now: input.now,
      uid: input.uid,
    });
    if (outcome !== "clean") blocked = true;
  }
  return blocked ? "blocked" : "clean";
}

export async function maintainCacheAdviceStore(input: {
  storeRoot: string;
  now: number;
}): Promise<MaintainCacheAdviceResult> {
  if (process.platform === "win32") return "suppressed";
  if (!Number.isFinite(input.now)) return "suppressed";
  try {
    const dependencies = resolveTaskKickoffStoreDependencies();
    await prepareTaskKickoffStoreRootDirectory(input.storeRoot, process.platform, dependencies);
    const v3Root = await prepareCacheAdviceV3Directory(
      input.storeRoot,
      process.platform,
      dependencies,
    );
    const uid = effectivePosixUserId();
    const lock = await acquireMigrationLock(
      v3Root,
      input.now - OVERLAY_RETENTION_MS,
      input.now,
      uid,
    );
    if (lock === null) return "incomplete";
    let outcome: MaintainCacheAdviceResult = "incomplete";
    let released = false;
    try {
      // Spec §2.1: only the off-hook maintainer may compact fully consumed
      // work-log bytes. This runs under the maintainer's own lock, before the
      // legacy sweep, so a capped append-only log is reclaimed each pass.
      await compactCacheAdviceQueue({ storeRoot: input.storeRoot });
      const sweep = await sweepAllLegacyTrees({ storeRoot: input.storeRoot, now: input.now, uid });
      if (sweep === "clean") {
        // Final clean rescan decides completeness only over known-shape nodes.
        const rescan = await sweepAllLegacyTrees({
          storeRoot: input.storeRoot,
          now: input.now,
          uid,
        });
        if (rescan === "clean") {
          await writeMigrationJournal(input.storeRoot, true, input.now);
          outcome = "complete";
        }
      }
      if (outcome !== "complete") {
        await writeMigrationJournal(input.storeRoot, false, null);
      }
    } finally {
      released = await releaseMigrationLock(v3Root, lock, uid);
    }
    return released ? outcome : "incomplete";
  } catch {
    return "suppressed";
  }
}
