import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";
import {
  type CacheAdviceCall,
  type CacheAdviceState,
  recordBatchCall,
} from "./cache-advice-state.js";
import {
  prepareCacheAdviceDirectory,
  prepareTaskKickoffStoreRootDirectory,
  resolveTaskKickoffStoreDependencies,
} from "./task-kickoff-store-fs.js";

const SAFE_SESSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DIRECTORY_KEY = /^[0-9a-f]{64}$/;
const MAX_CACHE_ADVICE_STATE_BYTES = 32_768;
const EMPTY_STATE: CacheAdviceState = {
  version: 2,
  offeredDirectoryKeys: [],
  recent: [],
};

const callSchema = z
  .object({
    tool: z.enum(["Read", "Grep", "Glob"]),
    directoryKey: z.string().regex(DIRECTORY_KEY),
    at: z.number().finite(),
  })
  .strict();
const stateSchema = z
  .object({
    version: z.literal(2),
    offeredDirectoryKeys: z.array(z.string().regex(DIRECTORY_KEY)).max(64),
    recent: z.array(callSchema).max(128),
  })
  .strict();

export type { CacheAdviceCall, CacheAdviceState } from "./cache-advice-state.js";

export type TransactCacheAdviceInput = {
  storeRoot: string;
  workspaceKey: string;
  sessionId: string;
  call: CacheAdviceCall;
  platform?: NodeJS.Platform;
};

type FileIdentity = { dev: number; ino: number };
type StateSnapshot = { state: CacheAdviceState; identity: FileIdentity | null };

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function effectiveUserId(): number {
  const uid = process.geteuid?.();
  if (uid === undefined) throw new Error("cache advice requires a POSIX user id");
  return uid;
}

function requirePrivateRegularFile(stats: Stats, uid: number): FileIdentity {
  if (!stats.isFile() || stats.nlink !== 1 || stats.uid !== uid || (stats.mode & 0o077) !== 0) {
    throw new Error("cache advice state node is unsafe");
  }
  return { dev: stats.dev, ino: stats.ino };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function readBounded(
  handle: Awaited<ReturnType<typeof open>>,
  size: number,
): Promise<string> {
  if (size > MAX_CACHE_ADVICE_STATE_BYTES) {
    throw new Error("cache advice state exceeds its byte ceiling");
  }
  const buffer = Buffer.alloc(MAX_CACHE_ADVICE_STATE_BYTES + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > MAX_CACHE_ADVICE_STATE_BYTES) {
    throw new Error("cache advice state exceeds its byte ceiling");
  }
  return buffer.subarray(0, offset).toString("utf8");
}

async function readState(path: string, uid: number): Promise<StateSnapshot> {
  let priorIdentity: FileIdentity | null = null;
  try {
    priorIdentity = requirePrivateRegularFile(await lstat(path), uid);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
  }

  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT") && priorIdentity === null) {
      return { state: EMPTY_STATE, identity: null };
    }
    throw error;
  }

  try {
    const stats = await handle.stat();
    const identity = requirePrivateRegularFile(stats, uid);
    if (priorIdentity !== null && !sameIdentity(priorIdentity, identity)) {
      throw new Error("cache advice state changed during descriptor open");
    }
    const raw = await readBounded(handle, stats.size);
    return { state: stateSchema.parse(JSON.parse(raw)), identity };
  } finally {
    await handle.close();
  }
}

async function writeComplete(
  handle: Awaited<ReturnType<typeof open>>,
  content: Buffer,
): Promise<void> {
  let offset = 0;
  while (offset < content.length) {
    const { bytesWritten } = await handle.write(content, offset, content.length - offset, null);
    if (bytesWritten <= 0) throw new Error("cache advice state write made no progress");
    offset += bytesWritten;
  }
}

async function requireExpectedDestination(
  path: string,
  expected: FileIdentity | null,
  uid: number,
): Promise<void> {
  try {
    const current = requirePrivateRegularFile(await lstat(path), uid);
    if (expected === null || !sameIdentity(current, expected)) {
      throw new Error("cache advice state destination changed before rename");
    }
  } catch (error) {
    if (hasErrorCode(error, "ENOENT") && expected === null) return;
    throw error;
  }
}

async function writeState(
  directory: string,
  path: string,
  state: CacheAdviceState,
  expected: FileIdentity | null,
  uid: number,
): Promise<void> {
  const content = Buffer.from(`${JSON.stringify(state)}\n`);
  if (content.byteLength > MAX_CACHE_ADVICE_STATE_BYTES) {
    throw new Error("cache advice state exceeds its byte ceiling");
  }
  const temporaryPath = join(directory, `.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let temporaryIdentity: FileIdentity | undefined;
  try {
    handle = await open(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600,
    );
    await handle.chmod(0o600);
    temporaryIdentity = requirePrivateRegularFile(await handle.stat(), uid);
    await writeComplete(handle, content);
    await handle.sync();
    await handle.close();
    handle = undefined;

    const namedTemporary = requirePrivateRegularFile(await lstat(temporaryPath), uid);
    if (!sameIdentity(namedTemporary, temporaryIdentity)) {
      throw new Error("cache advice temporary file changed before rename");
    }
    await requireExpectedDestination(path, expected, uid);
    await rename(temporaryPath, path);
    await resolveTaskKickoffStoreDependencies().syncDirectory(directory);
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      // Preserve the transaction failure.
    }
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (!hasErrorCode(cleanupError, "ENOENT")) {
        // Preserve the transaction failure.
      }
    }
    throw error;
  }
}

async function acquireLock(
  path: string,
  directory: string,
  uid: number,
): Promise<{ handle: Awaited<ReturnType<typeof open>>; identity: FileIdentity } | null> {
  let handle: Awaited<ReturnType<typeof open>>;
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
    const identity = requirePrivateRegularFile(await handle.stat(), uid);
    await handle.sync();
    await resolveTaskKickoffStoreDependencies().syncDirectory(directory);
    return { handle, identity };
  } catch (error) {
    try {
      await handle.close();
    } catch {
      // Preserve the lock acquisition failure.
    }
    try {
      await unlink(path);
    } catch {
      // Preserve the lock acquisition failure.
    }
    throw error;
  }
}

async function releaseLock(
  path: string,
  directory: string,
  lock: { handle: Awaited<ReturnType<typeof open>>; identity: FileIdentity },
  uid: number,
): Promise<boolean> {
  let released = true;
  try {
    await lock.handle.close();
  } catch {
    released = false;
  }
  try {
    const namedLock = requirePrivateRegularFile(await lstat(path), uid);
    if (!sameIdentity(namedLock, lock.identity)) return false;
    await unlink(path);
    await resolveTaskKickoffStoreDependencies().syncDirectory(directory);
  } catch {
    return false;
  }
  return released;
}

export async function transactCacheAdvice(
  input: TransactCacheAdviceInput,
): Promise<"advise" | "recorded" | "suppressed"> {
  const platform = input.platform ?? process.platform;
  if (platform === "win32") return "suppressed";
  const workspaceKey = workspaceKeySchema.safeParse(input.workspaceKey);
  const call = callSchema.safeParse(input.call);
  if (!workspaceKey.success || !SAFE_SESSION.test(input.sessionId) || !call.success) {
    return "suppressed";
  }

  let directory: string;
  let lock: Awaited<ReturnType<typeof acquireLock>>;
  let uid: number;
  try {
    uid = effectiveUserId();
    const dependencies = resolveTaskKickoffStoreDependencies();
    await prepareTaskKickoffStoreRootDirectory(input.storeRoot, platform, dependencies);
    directory = await prepareCacheAdviceDirectory(
      input.storeRoot,
      workspaceKey.data,
      platform,
      dependencies,
    );
    lock = await acquireLock(join(directory, `${input.sessionId}.lock`), directory, uid);
  } catch {
    return "suppressed";
  }
  if (lock === null) return "suppressed";

  const path = join(directory, `${input.sessionId}.json`);
  let result: "advise" | "recorded" | "suppressed" = "suppressed";
  try {
    const snapshot = await readState(path, uid);
    const decision = recordBatchCall(snapshot.state, call.data);
    await writeState(directory, path, decision.state, snapshot.identity, uid);
    result = decision.advise ? "advise" : "recorded";
  } catch {
    result = "suppressed";
  }

  const released = await releaseLock(
    join(directory, `${input.sessionId}.lock`),
    directory,
    lock,
    uid,
  );
  return released ? result : "suppressed";
}
