import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";
import {
  type TaskKickoffStoreDependencies,
  createExclusiveDurableFile,
  prepareTaskKickoffClaimDirectory,
  prepareTaskKickoffDirectories,
  prepareTaskKickoffIntentDirectory,
  prepareTaskKickoffPackDirectory,
  prepareTaskKickoffStoreRootDirectory,
  resolveTaskKickoffStoreDependencies,
  writeAtomicDurableFile,
} from "./task-kickoff-store-fs.js";

export type { TaskKickoffStoreDependencies } from "./task-kickoff-store-fs.js";

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
    workspaceKey: workspaceKeySchema,
    eventId: z.string().uuid(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export function isSafeHookSessionId(value: string): boolean {
  return safeSessionId.test(value);
}

export function taskKickoffPackPath(root: string, workspace: string, session: string): string {
  if (!isSafeHookSessionId(session)) throw new Error("Unsafe hook session id");
  return join(root, "stats", workspaceKeySchema.parse(workspace), "task-pack", `${session}.json`);
}

export function taskKickoffSessionClaimPath(root: string, session: string): string {
  if (!isSafeHookSessionId(session)) throw new Error("Unsafe hook session id");
  return join(root, "stats", "task-kickoff-sessions", `${session}.json`);
}

export function hasTaskKickoffSessionClaim(storeRoot: string, sessionId: string): boolean {
  if (!isSafeHookSessionId(sessionId)) return false;
  return existsSync(taskKickoffSessionClaimPath(storeRoot, sessionId));
}

export async function prepareTaskKickoffStoreRoot(
  storeRoot: string,
  options?: {
    platform?: NodeJS.Platform;
    dependencies?: Partial<TaskKickoffStoreDependencies>;
  },
): Promise<boolean> {
  const dependencies = resolveTaskKickoffStoreDependencies(options?.dependencies);
  try {
    await prepareTaskKickoffStoreRootDirectory(
      storeRoot,
      options?.platform ?? process.platform,
      dependencies,
    );
    return true;
  } catch {
    return false;
  }
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
  if (!workspaceKeySchema.safeParse(workspaceKey).success) return null;
  const claimPath = taskKickoffSessionClaimPath(storeRoot, sessionId);
  const packPath = taskKickoffPackPath(storeRoot, workspaceKey, sessionId);
  const dependencies = resolveTaskKickoffStoreDependencies(options.dependencies);

  try {
    const platform = options.platform ?? process.platform;
    const directories = await prepareTaskKickoffDirectories(
      storeRoot,
      workspaceKey,
      platform,
      dependencies,
    );
    if (options.signal.aborted) return null;

    return {
      createSessionClaim: (claim, signal) =>
        createExclusiveDurableFile(
          claimPath,
          `${JSON.stringify(taskKickoffSessionClaimSchema.parse(claim))}\n`,
          signal,
          dependencies,
        ),
      writePack: (pack, signal) =>
        writeAtomicDurableFile(
          directories.packDirectory,
          packPath,
          `${JSON.stringify(storedTaskKickoffPackSchema.parse(pack))}\n`,
          signal,
          dependencies,
        ),
    };
  } catch {
    return null;
  }
}

export async function prepareTaskKickoffIntentCapture(
  storeRoot: string,
  workspaceKey: string,
  options?: {
    platform?: NodeJS.Platform;
    dependencies?: Partial<TaskKickoffStoreDependencies>;
  },
): Promise<boolean> {
  if (!workspaceKeySchema.safeParse(workspaceKey).success) return false;
  const dependencies = resolveTaskKickoffStoreDependencies(options?.dependencies);
  const platform = options?.platform ?? process.platform;
  try {
    await prepareTaskKickoffStoreRootDirectory(storeRoot, platform, dependencies);
    await prepareTaskKickoffIntentDirectory(storeRoot, workspaceKey, platform, dependencies);
    return true;
  } catch {
    return false;
  }
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
  const dependencies = resolveTaskKickoffStoreDependencies(overrides);
  await prepareTaskKickoffClaimDirectory(storeRoot, process.platform, dependencies);
  return createExclusiveDurableFile(path, `${JSON.stringify(parsed)}\n`, signal, dependencies);
}

export function readTaskKickoffPack(
  storeRoot: string,
  workspaceKey: string,
  sessionId: string,
): StoredTaskKickoffPack | undefined {
  if (!isSafeHookSessionId(sessionId)) return undefined;
  if (!workspaceKeySchema.safeParse(workspaceKey).success) return undefined;
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
  workspaceKeySchema.parse(workspaceKey);
  const validated = storedTaskKickoffPackSchema.parse(pack);
  const path = taskKickoffPackPath(storeRoot, workspaceKey, sessionId);
  const dependencies = resolveTaskKickoffStoreDependencies(overrides);
  const directory = await prepareTaskKickoffPackDirectory(
    storeRoot,
    workspaceKey,
    process.platform,
    dependencies,
  );
  await writeAtomicDurableFile(
    directory,
    path,
    `${JSON.stringify(validated)}\n`,
    new AbortController().signal,
    dependencies,
  );
}
