import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  mkdir as makeDirectory,
  open as openPath,
  rm as removePath,
  rename as renamePath,
} from "node:fs/promises";
import { dirname, join } from "node:path";

type TaskKickoffDurableHandle = {
  sync: () => Promise<void>;
  close: () => Promise<void>;
};

type TaskKickoffFileHandle = TaskKickoffDurableHandle & {
  writeFile: (content: string) => Promise<void>;
};

type TaskKickoffDirectoryHandle = TaskKickoffDurableHandle & {
  chmod: (mode: number) => Promise<void>;
};

export type TaskKickoffStoreDependencies = {
  mkdir: (path: string, options: { mode: number }) => Promise<void>;
  open: (path: string, flags: "r" | "wx", mode?: number) => Promise<TaskKickoffFileHandle>;
  openDirectory: (path: string) => Promise<TaskKickoffDirectoryHandle>;
  rename: (source: string, destination: string) => Promise<void>;
  remove: (path: string, options: { force: true }) => Promise<void>;
  syncDirectory: (path: string) => Promise<void>;
};

export type TaskKickoffDirectories = {
  claimDirectory: string;
  packDirectory: string;
  intentDirectory: string;
};

async function runWithHandle(
  handle: TaskKickoffDurableHandle,
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

async function openDirectory(path: string): Promise<TaskKickoffDirectoryHandle> {
  return openPath(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await openDirectory(path);
  await runWithHandle(handle, () => handle.sync());
}

const defaultDependencies: TaskKickoffStoreDependencies = {
  async mkdir(path, options) {
    await makeDirectory(path, options);
  },
  open: openPath,
  openDirectory,
  rename: renamePath,
  async remove(path, options) {
    await removePath(path, options);
  },
  syncDirectory,
};

export function resolveTaskKickoffStoreDependencies(
  overrides?: Partial<TaskKickoffStoreDependencies>,
): TaskKickoffStoreDependencies {
  return { ...defaultDependencies, ...overrides };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function prepareOwnerOnlyChild(
  parent: string,
  child: string,
  dependencies: TaskKickoffStoreDependencies,
): Promise<string> {
  const path = join(parent, child);
  try {
    await dependencies.mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) throw error;
  }
  const handle = await dependencies.openDirectory(path);
  await runWithHandle(handle, async () => {
    await handle.chmod(0o700);
    await handle.sync();
  });
  await dependencies.syncDirectory(parent);
  return path;
}

async function prepareStatsDirectory(
  storeRoot: string,
  dependencies: TaskKickoffStoreDependencies,
): Promise<string> {
  await dependencies.syncDirectory(storeRoot);
  return prepareOwnerOnlyChild(storeRoot, "stats", dependencies);
}

export async function prepareTaskKickoffClaimDirectory(
  storeRoot: string,
  dependencies: TaskKickoffStoreDependencies,
): Promise<string> {
  const statsDirectory = await prepareStatsDirectory(storeRoot, dependencies);
  return prepareOwnerOnlyChild(statsDirectory, "task-kickoff-sessions", dependencies);
}

export async function prepareTaskKickoffPackDirectory(
  storeRoot: string,
  workspaceKey: string,
  dependencies: TaskKickoffStoreDependencies,
): Promise<string> {
  const statsDirectory = await prepareStatsDirectory(storeRoot, dependencies);
  const workspaceDirectory = await prepareOwnerOnlyChild(
    statsDirectory,
    workspaceKey,
    dependencies,
  );
  return prepareOwnerOnlyChild(workspaceDirectory, "task-pack", dependencies);
}

export async function prepareTaskKickoffDirectories(
  storeRoot: string,
  workspaceKey: string,
  dependencies: TaskKickoffStoreDependencies,
): Promise<TaskKickoffDirectories> {
  const statsDirectory = await prepareStatsDirectory(storeRoot, dependencies);
  const claimDirectory = await prepareOwnerOnlyChild(
    statsDirectory,
    "task-kickoff-sessions",
    dependencies,
  );
  const workspaceDirectory = await prepareOwnerOnlyChild(
    statsDirectory,
    workspaceKey,
    dependencies,
  );
  const packDirectory = await prepareOwnerOnlyChild(workspaceDirectory, "task-pack", dependencies);
  const intentDirectory = await prepareOwnerOnlyChild(workspaceDirectory, "intent", dependencies);
  return { claimDirectory, packDirectory, intentDirectory };
}

export async function createExclusiveDurableFile(
  path: string,
  content: string,
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
      await handle.writeFile(content);
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

export async function writeAtomicDurableFile(
  directory: string,
  path: string,
  content: string,
  signal: AbortSignal,
  dependencies: TaskKickoffStoreDependencies,
): Promise<boolean> {
  if (signal.aborted) return false;
  const temporaryPath = join(directory, `.${randomUUID()}.tmp`);
  const handle = await dependencies.open(temporaryPath, "wx", 0o600);

  try {
    await runWithHandle(handle, async () => {
      await handle.writeFile(content);
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
