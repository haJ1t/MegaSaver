import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  prepareCacheAdviceV3Directory,
  prepareOwnerOnlyStoreChild,
  prepareTaskKickoffStoreRootDirectory,
  resolveTaskKickoffStoreDependencies,
} from "./task-kickoff-store-fs.js";

export const CACHE_ADVICE_QUEUE_ROOT = "cache-advice-v3";
export const CACHE_ADVICE_QUEUE_WORK_LOG_BYTES = 1_048_576;
export const CACHE_ADVICE_QUEUE_CONTROL_BYTES = 4_096;
const RECORD_ID = /^[0-9a-f]{64}$/;
const RECORD_KEY_DOMAIN = "megasaver:cache-advice:record:v3\0";
const CONTROL_FILE = "control.json";
const WORK_FILE = "work-1.jsonl";
const LOCK_FILE = "lock";

const controlSchema = z
  .object({
    version: z.literal(1),
    headOffset: z.number().int().min(0),
    inflightOffset: z.number().int().min(0).nullable(),
    sweepStopOffset: z.number().int().min(0).nullable(),
    lastCompletedAt: z.number().finite().nullable(),
    clockCutAt: z.number().finite().nullable(),
  })
  .strict();

export type CacheAdviceRecordId = string;
export type CacheAdviceQueueControl = z.infer<typeof controlSchema>;

type FileIdentity = { dev: number; ino: number };
type Lock = { path: string; handle: Awaited<ReturnType<typeof open>>; identity: FileIdentity };
type Frame = { line: string; start: number; length: number };

export async function readCacheAdviceQueueProgress(storeRoot: string): Promise<{
  sweepActive: boolean;
  lastCompletedAt: number | null;
} | null> {
  if (process.platform === "win32") return null;
  try {
    const { root, uid } = await prepareQueueRoot(storeRoot);
    const control = await readControl(root, uid);
    return {
      sweepActive: control.sweepStopOffset !== null,
      lastCompletedAt: control.lastCompletedAt,
    };
  } catch {
    return null;
  }
}

function effectiveUserId(): number {
  const uid = process.geteuid?.();
  if (uid === undefined) throw new Error("cache advice queue requires a POSIX user id");
  return uid;
}

function requirePrivateRegularFile(stats: Stats, uid: number): FileIdentity {
  if (!stats.isFile() || stats.nlink !== 1 || stats.uid !== uid || (stats.mode & 0o077) !== 0) {
    throw new Error("cache advice queue node is unsafe");
  }
  return { dev: stats.dev, ino: stats.ino };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function cacheAdviceRecordId(input: {
  workspaceKey: string;
  sessionStorageKey: string;
}): CacheAdviceRecordId {
  return createHash("sha256")
    .update(RECORD_KEY_DOMAIN, "utf8")
    .update(input.workspaceKey, "utf8")
    .update("\0", "utf8")
    .update(input.sessionStorageKey, "utf8")
    .digest("hex");
}

export function cacheAdviceRecordDirectory(storeRoot: string, recordId: string): string {
  return join(
    storeRoot,
    "stats",
    CACHE_ADVICE_QUEUE_ROOT,
    "records",
    recordId.slice(0, 2),
    recordId.slice(2, 4),
    recordId,
  );
}

async function acquireQueueLock(root: string, uid: number): Promise<Lock | null> {
  const path = join(root, "queue", LOCK_FILE);
  try {
    const handle = await open(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600,
    );
    await handle.chmod(0o600);
    const identity = requirePrivateRegularFile(await handle.stat(), uid);
    await handle.sync();
    await resolveTaskKickoffStoreDependencies().syncDirectory(join(root, "queue"));
    return { path, handle, identity };
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) return null;
    throw error;
  }
}

async function releaseQueueLock(lock: Lock, uid: number): Promise<boolean> {
  let released = true;
  try {
    await lock.handle.close();
  } catch {
    released = false;
  }
  try {
    const current = requirePrivateRegularFile(await lstat(lock.path), uid);
    if (!sameIdentity(current, lock.identity)) return false;
    await unlink(lock.path);
    await resolveTaskKickoffStoreDependencies().syncDirectory(dirname(lock.path));
  } catch {
    return false;
  }
  return released;
}

async function readHandleBounded(handle: FileHandle, ceiling: number): Promise<string> {
  const buffer = Buffer.alloc(ceiling + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > ceiling) throw new Error("cache advice queue node exceeds its byte ceiling");
  return buffer.subarray(0, offset).toString("utf8");
}

async function writeHandleComplete(handle: FileHandle, content: string): Promise<void> {
  const buffer = Buffer.from(content, "utf8");
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, null);
    if (bytesWritten <= 0) throw new Error("cache advice queue write made no progress");
    offset += bytesWritten;
  }
}

async function replaceWorkLog(queueRoot: string, content: string, uid: number): Promise<void> {
  const temporaryPath = join(queueRoot, `.${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  let identity: FileIdentity | undefined;
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
    identity = requirePrivateRegularFile(await handle.stat(), uid);
    await writeHandleComplete(handle, content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    const named = requirePrivateRegularFile(await lstat(temporaryPath), uid);
    if (!sameIdentity(named, identity)) {
      throw new Error("queue work temporary changed before rename");
    }
    await rename(temporaryPath, join(queueRoot, WORK_FILE));
    await resolveTaskKickoffStoreDependencies().syncDirectory(queueRoot);
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      // Preserve the work-log transaction failure.
    }
    if (identity !== undefined) {
      try {
        const current = requirePrivateRegularFile(await lstat(temporaryPath), uid);
        if (sameIdentity(current, identity)) await unlink(temporaryPath);
      } catch {
        // Preserve the work-log transaction failure.
      }
    }
    throw error;
  }
}

async function readControl(root: string, uid: number): Promise<CacheAdviceQueueControl> {
  const path = join(root, "queue", CONTROL_FILE);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const named = requirePrivateRegularFile(await lstat(path), uid);
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = requirePrivateRegularFile(await handle.stat(), uid);
    if (!sameIdentity(named, opened)) throw new Error("queue control changed during open");
    const raw = await readHandleBounded(handle, CACHE_ADVICE_QUEUE_CONTROL_BYTES);
    if (Buffer.byteLength(raw, "utf8") > CACHE_ADVICE_QUEUE_CONTROL_BYTES) {
      throw new Error("queue control exceeds its byte ceiling");
    }
    return controlSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return {
        version: 1,
        headOffset: 0,
        inflightOffset: null,
        sweepStopOffset: null,
        lastCompletedAt: null,
        clockCutAt: null,
      };
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function replaceControl(
  root: string,
  control: CacheAdviceQueueControl,
  uid: number,
): Promise<void> {
  const queueRoot = join(root, "queue");
  const temporaryPath = join(queueRoot, `.${randomUUID()}.tmp`);
  let temporaryHandle: Awaited<ReturnType<typeof open>> | undefined;
  let temporaryIdentity: FileIdentity | undefined;
  try {
    const content = `${JSON.stringify(control)}\n`;
    temporaryHandle = await open(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600,
    );
    await temporaryHandle.chmod(0o600);
    temporaryIdentity = requirePrivateRegularFile(await temporaryHandle.stat(), uid);
    await temporaryHandle.write(content);
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;
    const named = requirePrivateRegularFile(await lstat(temporaryPath), uid);
    if (!sameIdentity(named, temporaryIdentity)) {
      throw new Error("queue control temporary changed before rename");
    }
    await rename(temporaryPath, join(queueRoot, CONTROL_FILE));
    await resolveTaskKickoffStoreDependencies().syncDirectory(queueRoot);
  } catch (error) {
    try {
      await temporaryHandle?.close();
    } catch {
      // Preserve the control transaction failure.
    }
    if (temporaryIdentity !== undefined) {
      try {
        const current = requirePrivateRegularFile(await lstat(temporaryPath), uid);
        if (sameIdentity(current, temporaryIdentity)) await unlink(temporaryPath);
      } catch {
        // Preserve the control transaction failure.
      }
    }
    throw error;
  }
}

async function readWork(root: string, uid: number): Promise<string> {
  const path = join(root, "queue", WORK_FILE);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const named = requirePrivateRegularFile(await lstat(path), uid);
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = requirePrivateRegularFile(await handle.stat(), uid);
    if (!sameIdentity(named, opened)) throw new Error("queue work log changed during open");
    return await readHandleBounded(handle, CACHE_ADVICE_QUEUE_WORK_LOG_BYTES);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return "";
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function workFrames(work: string): Frame[] {
  const frames: Frame[] = [];
  let start = 0;
  while (start < work.length) {
    const newline = work.indexOf("\n", start);
    if (newline === -1) throw new Error("queue work frame is unterminated");
    const line = work.slice(start, newline);
    frames.push({ line, start, length: newline - start + 1 });
    start = newline + 1;
  }
  return frames;
}

function frameRecordId(line: string): CacheAdviceRecordId {
  const parsed = z
    .object({ recordId: z.string().regex(RECORD_ID) })
    .strict()
    .safeParse(JSON.parse(line));
  if (!parsed.success) throw new Error("queue frame is malformed");
  return parsed.data.recordId;
}

export async function sweepCacheAdviceBatch(input: {
  storeRoot: string;
  now: number;
  batchSize: number;
  processFrame: (recordId: CacheAdviceRecordId) => Promise<"advance" | "requeue" | "suppress">;
}): Promise<"completed" | "incomplete" | "suppressed"> {
  if (
    !Number.isFinite(input.now) ||
    !Number.isInteger(input.batchSize) ||
    input.batchSize < 1 ||
    process.platform === "win32"
  ) {
    return "suppressed";
  }
  try {
    const { root, uid } = await prepareQueueRoot(input.storeRoot);
    const lock = await acquireQueueLock(root, uid);
    if (lock === null) return "suppressed";
    let result: "completed" | "incomplete" | "suppressed" = "suppressed";
    let released = false;
    try {
      let control = await readControl(root, uid);
      if (control.inflightOffset !== null) {
        control = { ...control, headOffset: control.inflightOffset, inflightOffset: null };
        await replaceControl(root, control, uid);
      }
      let processed = 0;
      let suppressed = false;
      let exhaustedBudget = true;
      while (processed < input.batchSize) {
        const work = await readWork(root, uid);
        const frames = workFrames(work);
        if (control.sweepStopOffset === null) {
          if (frames.length === 0) {
            control = {
              ...control,
              headOffset: 0,
              inflightOffset: null,
              sweepStopOffset: null,
              lastCompletedAt: input.now,
            };
            await replaceControl(root, control, uid);
            exhaustedBudget = false;
            break;
          }
          control = {
            ...control,
            headOffset: 0,
            sweepStopOffset: Buffer.byteLength(work, "utf8"),
            lastCompletedAt: null,
          };
          await replaceControl(root, control, uid);
          continue;
        }
        const head = frames.find((frame) => frame.start === control.headOffset);
        if (head === undefined || control.headOffset >= control.sweepStopOffset) {
          control = {
            ...control,
            headOffset: 0,
            inflightOffset: null,
            sweepStopOffset: null,
            lastCompletedAt: input.now,
          };
          await replaceControl(root, control, uid);
          exhaustedBudget = false;
          break;
        }
        control = {
          ...control,
          headOffset: head.start + head.length,
          inflightOffset: head.start,
        };
        await replaceControl(root, control, uid);
        const outcome = await input.processFrame(frameRecordId(head.line));
        if (outcome === "suppress") {
          suppressed = true;
          break;
        }
        const latest = await readWork(root, uid);
        if (outcome === "requeue") {
          const next = `${latest}${head.line}\n`;
          if (Buffer.byteLength(next, "utf8") > CACHE_ADVICE_QUEUE_WORK_LOG_BYTES) {
            suppressed = true;
            break;
          }
          await replaceWorkLog(join(root, "queue"), next, uid);
        }
        control = { ...control, inflightOffset: null };
        await replaceControl(root, control, uid);
        processed += 1;
      }
      result = suppressed ? "suppressed" : exhaustedBudget ? "incomplete" : "completed";
    } finally {
      released = await releaseQueueLock(lock, uid);
    }
    return released ? result : "suppressed";
  } catch {
    return "suppressed";
  }
}

async function prepareQueueRoot(storeRoot: string): Promise<{ root: string; uid: number }> {
  const dependencies = resolveTaskKickoffStoreDependencies();
  await prepareTaskKickoffStoreRootDirectory(storeRoot, process.platform, dependencies);
  const root = await prepareCacheAdviceV3Directory(storeRoot, process.platform, dependencies);
  await prepareOwnerOnlyStoreChild(root, "queue", process.platform, dependencies);
  await prepareOwnerOnlyStoreChild(root, "records", process.platform, dependencies);
  return { root, uid: effectiveUserId() };
}

export async function enqueueCacheAdviceRecord(input: {
  storeRoot: string;
  recordId: CacheAdviceRecordId;
}): Promise<"enqueued" | "suppressed"> {
  if (!RECORD_ID.test(input.recordId) || process.platform === "win32") return "suppressed";
  try {
    const { root, uid } = await prepareQueueRoot(input.storeRoot);
    const lock = await acquireQueueLock(root, uid);
    if (lock === null) return "suppressed";
    let released = false;
    try {
      const control = await readControl(root, uid);
      const work = await readWork(root, uid);
      const frame = `${JSON.stringify({ recordId: input.recordId })}\n`;
      const lines = work.split("\n").filter(Boolean);
      if (!lines.includes(JSON.stringify({ recordId: input.recordId }))) {
        const next = `${work}${frame}`;
        if (Buffer.byteLength(next, "utf8") > CACHE_ADVICE_QUEUE_WORK_LOG_BYTES) {
          return "suppressed";
        }
        await replaceWorkLog(join(root, "queue"), next, uid);
      }
      await replaceControl(root, control, uid);
    } finally {
      released = await releaseQueueLock(lock, uid);
    }
    return released ? "enqueued" : "suppressed";
  } catch {
    return "suppressed";
  }
}

export async function claimCacheAdviceQueueHead(input: {
  storeRoot: string;
  now: number;
}): Promise<{ recordId: CacheAdviceRecordId; freshStart: boolean } | "suppressed" | "complete"> {
  if (!Number.isFinite(input.now) || process.platform === "win32") return "suppressed";
  try {
    const { root, uid } = await prepareQueueRoot(input.storeRoot);
    const lock = await acquireQueueLock(root, uid);
    if (lock === null) return "suppressed";
    let result: { recordId: CacheAdviceRecordId; freshStart: boolean } | "suppressed" | "complete" =
      "suppressed";
    let released = false;
    try {
      let control = await readControl(root, uid);
      if (control.inflightOffset !== null) {
        control = { ...control, headOffset: control.inflightOffset, inflightOffset: null };
        await replaceControl(root, control, uid);
      }
      const work = await readWork(root, uid);
      const lines = work.split("\n").filter(Boolean);
      let lineStart = 0;
      let headLine: string | undefined;
      for (const line of lines) {
        if (lineStart >= control.headOffset) {
          headLine = line;
          break;
        }
        lineStart += Buffer.byteLength(`${line}\n`, "utf8");
      }
      if (headLine === undefined) {
        control = {
          ...control,
          headOffset: 0,
          inflightOffset: null,
          sweepStopOffset: null,
          lastCompletedAt: input.now,
        };
        await replaceControl(root, control, uid);
        result = "complete";
      } else {
        const parsed = z
          .object({ recordId: z.string().regex(RECORD_ID) })
          .strict()
          .safeParse(JSON.parse(headLine));
        if (!parsed.success) throw new Error("queue frame is malformed");
        const headBytes = Buffer.byteLength(`${headLine}\n`, "utf8");
        const sweepStopOffset = control.sweepStopOffset ?? Buffer.byteLength(work, "utf8");
        control = {
          ...control,
          headOffset: control.headOffset + headBytes,
          inflightOffset: control.headOffset,
          sweepStopOffset,
          lastCompletedAt: null,
        };
        await replaceControl(root, control, uid);
        result = { recordId: parsed.data.recordId, freshStart: true };
      }
    } finally {
      released = await releaseQueueLock(lock, uid);
    }
    return released ? result : "suppressed";
  } catch {
    return "suppressed";
  }
}

export async function requeueCacheAdviceRecord(input: {
  storeRoot: string;
  recordId: CacheAdviceRecordId;
}): Promise<"requeued" | "suppressed"> {
  if (!RECORD_ID.test(input.recordId) || process.platform === "win32") return "suppressed";
  try {
    const { root, uid } = await prepareQueueRoot(input.storeRoot);
    const lock = await acquireQueueLock(root, uid);
    if (lock === null) return "suppressed";
    let released = false;
    try {
      const control = await readControl(root, uid);
      if (control.inflightOffset === null) return "suppressed";
      const work = await readWork(root, uid);
      const next = `${work}${JSON.stringify({ recordId: input.recordId })}\n`;
      if (Buffer.byteLength(next, "utf8") > CACHE_ADVICE_QUEUE_WORK_LOG_BYTES) {
        return "suppressed";
      }
      await replaceWorkLog(join(root, "queue"), next, uid);
      await replaceControl(root, { ...control, inflightOffset: null }, uid);
    } finally {
      released = await releaseQueueLock(lock, uid);
    }
    return released ? "requeued" : "suppressed";
  } catch {
    return "suppressed";
  }
}
