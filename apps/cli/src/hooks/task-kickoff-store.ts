import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  chmod as chmodPath,
  mkdir as makeDirectory,
  open as openPath,
  rm as removePath,
  rename as renamePath,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

export type StoredTaskKickoffPack = {
  taskHash: string;
  text: string;
  tokenCount: number;
  createdAt: number;
};

export type TaskKickoffSessionClaim = {
  workspaceKey: string;
  eventId: string;
  createdAt: string;
};

type TaskKickoffFileHandle = {
  writeFile: (content: string) => Promise<void>;
  sync: () => Promise<void>;
  close: () => Promise<void>;
};

export type TaskKickoffStoreDependencies = {
  mkdir: (path: string, options: { recursive: true; mode: number }) => Promise<void>;
  chmod: (path: string, mode: number) => Promise<void>;
  open: (path: string, flags: "r" | "wx", mode?: number) => Promise<TaskKickoffFileHandle>;
  rename: (source: string, destination: string) => Promise<void>;
  remove: (path: string, options: { force: true }) => Promise<void>;
  syncDirectory: (path: string) => Promise<void>;
};

export type PreparedTaskKickoffStorage = {
  createSessionClaim: (claim: TaskKickoffSessionClaim, signal: AbortSignal) => Promise<boolean>;
  writePack: (pack: StoredTaskKickoffPack, signal: AbortSignal) => Promise<boolean>;
};

const safeSessionId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const storedTaskKickoffPackSchema = z
  .object({
    taskHash: z.string().regex(/^[a-f0-9]{64}$/),
    text: z.string().min(1),
    tokenCount: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();
const taskKickoffSessionClaimSchema = z
  .object({
    workspaceKey: z.string().min(1),
    eventId: z.string().uuid(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

async function runWithHandle(
  handle: TaskKickoffFileHandle,
  operation: () => Promise<void>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    try {
      await handle.close();
    } catch {
      // Preserve the operation failure.
    }
    throw error;
  }
  await handle.close();
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await openPath(path, "r");
  await runWithHandle(handle, () => handle.sync());
}

const defaultDependencies: TaskKickoffStoreDependencies = {
  async mkdir(path, options) {
    await makeDirectory(path, options);
  },
  chmod: chmodPath,
  open: openPath,
  rename: renamePath,
  async remove(path, options) {
    await removePath(path, options);
  },
  syncDirectory,
};

function resolveDependencies(
  overrides?: Partial<TaskKickoffStoreDependencies>,
): TaskKickoffStoreDependencies {
  return { ...defaultDependencies, ...overrides };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function ensureOwnerOnlyDirectory(
  path: string,
  dependencies: TaskKickoffStoreDependencies,
): Promise<void> {
  await dependencies.mkdir(path, { recursive: true, mode: 0o700 });
  await dependencies.chmod(path, 0o700);
  await dependencies.syncDirectory(path);
}

async function createSessionClaimAtPath(
  path: string,
  claim: TaskKickoffSessionClaim,
  signal: AbortSignal,
  dependencies: TaskKickoffStoreDependencies,
): Promise<boolean> {
  if (signal.aborted) return false;

  let handle: TaskKickoffFileHandle;
  try {
    handle = await dependencies.open(path, "wx", 0o600);
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) return false;
    throw error;
  }

  let failed = false;
  let failure: unknown;
  try {
    await runWithHandle(handle, async () => {
      await handle.writeFile(`${JSON.stringify(claim)}\n`);
      await handle.sync();
    });
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    await dependencies.syncDirectory(dirname(path));
  } catch (error) {
    if (!failed) {
      failed = true;
      failure = error;
    }
  }
  if (failed) throw failure;
  return !signal.aborted;
}

async function writePackAtPath(
  path: string,
  pack: StoredTaskKickoffPack,
  signal: AbortSignal,
  dependencies: TaskKickoffStoreDependencies,
): Promise<boolean> {
  if (signal.aborted) return false;
  const directory = dirname(path);
  const temporaryPath = join(directory, `.${randomUUID()}.tmp`);
  const handle = await dependencies.open(temporaryPath, "wx", 0o600);

  try {
    await runWithHandle(handle, async () => {
      await handle.writeFile(`${JSON.stringify(pack)}\n`);
      await handle.sync();
    });
  } catch (error) {
    try {
      await dependencies.remove(temporaryPath, { force: true });
    } catch {
      // Preserve the file write or synchronization failure.
    }
    throw error;
  }

  if (signal.aborted) {
    await dependencies.remove(temporaryPath, { force: true });
    return false;
  }

  try {
    await dependencies.rename(temporaryPath, path);
  } catch (error) {
    try {
      await dependencies.remove(temporaryPath, { force: true });
    } catch {
      // Preserve the rename failure.
    }
    throw error;
  }

  await dependencies.syncDirectory(directory);
  return !signal.aborted;
}

export function isSafeHookSessionId(value: string): boolean {
  return safeSessionId.test(value);
}

export function taskKickoffPackPath(root: string, workspace: string, session: string): string {
  if (!isSafeHookSessionId(session)) throw new Error("Unsafe hook session id");
  return join(root, "stats", workspace, "task-pack", `${session}.json`);
}

export function taskKickoffSessionClaimPath(root: string, session: string): string {
  if (!isSafeHookSessionId(session)) throw new Error("Unsafe hook session id");
  return join(root, "stats", "task-kickoff-sessions", `${session}.json`);
}

export function hasTaskKickoffSessionClaim(storeRoot: string, sessionId: string): boolean {
  if (!isSafeHookSessionId(sessionId)) return false;
  return existsSync(taskKickoffSessionClaimPath(storeRoot, sessionId));
}

export async function prepareTaskKickoffStorage(
  storeRoot: string,
  workspaceKey: string,
  sessionId: string,
  options: {
    platform?: NodeJS.Platform;
    signal: AbortSignal;
    dependencies?: Partial<TaskKickoffStoreDependencies>;
  },
): Promise<PreparedTaskKickoffStorage | null> {
  if ((options.platform ?? process.platform) === "win32" || options.signal.aborted) return null;
  const claimPath = taskKickoffSessionClaimPath(storeRoot, sessionId);
  const packPath = taskKickoffPackPath(storeRoot, workspaceKey, sessionId);
  const dependencies = resolveDependencies(options.dependencies);

  try {
    await ensureOwnerOnlyDirectory(dirname(packPath), dependencies);
    if (options.signal.aborted) return null;
    await ensureOwnerOnlyDirectory(dirname(claimPath), dependencies);
    if (options.signal.aborted) return null;
  } catch {
    return null;
  }

  return {
    createSessionClaim: (claim, signal) =>
      createSessionClaimAtPath(
        claimPath,
        taskKickoffSessionClaimSchema.parse(claim),
        signal,
        dependencies,
      ),
    writePack: (pack, signal) =>
      writePackAtPath(packPath, storedTaskKickoffPackSchema.parse(pack), signal, dependencies),
  };
}

export async function createTaskKickoffSessionClaim(
  storeRoot: string,
  sessionId: string,
  claim: TaskKickoffSessionClaim,
  signal: AbortSignal,
  overrides?: Partial<TaskKickoffStoreDependencies>,
): Promise<boolean> {
  if (signal.aborted) return false;
  const parsed = taskKickoffSessionClaimSchema.parse(claim);
  const path = taskKickoffSessionClaimPath(storeRoot, sessionId);
  const dependencies = resolveDependencies(overrides);
  await ensureOwnerOnlyDirectory(dirname(path), dependencies);
  return createSessionClaimAtPath(path, parsed, signal, dependencies);
}

export function readTaskKickoffPack(
  storeRoot: string,
  workspaceKey: string,
  sessionId: string,
): StoredTaskKickoffPack | undefined {
  if (!isSafeHookSessionId(sessionId)) return undefined;
  try {
    const path = taskKickoffPackPath(storeRoot, workspaceKey, sessionId);
    const parsed = storedTaskKickoffPackSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
}

export async function writeTaskKickoffPack(
  storeRoot: string,
  workspaceKey: string,
  sessionId: string,
  pack: StoredTaskKickoffPack,
  overrides?: Partial<TaskKickoffStoreDependencies>,
): Promise<void> {
  const validated = storedTaskKickoffPackSchema.parse(pack);
  const path = taskKickoffPackPath(storeRoot, workspaceKey, sessionId);
  const dependencies = resolveDependencies(overrides);
  await ensureOwnerOnlyDirectory(dirname(path), dependencies);
  await writePackAtPath(path, validated, new AbortController().signal, dependencies);
}
