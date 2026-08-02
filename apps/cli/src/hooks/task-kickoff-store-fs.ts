import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat as lstatPath,
  mkdir as makeDirectory,
  open as openPath,
  rm as removePath,
  rename as renamePath,
} from "node:fs/promises";
import { dirname, join, parse, resolve, sep } from "node:path";

type TaskKickoffDurableHandle = {
  sync: () => Promise<void>;
  close: () => Promise<void>;
};

type TaskKickoffFileHandle = TaskKickoffDurableHandle & {
  writeFile: (content: string) => Promise<void>;
};

type TaskKickoffDirectoryHandle = TaskKickoffDurableHandle & {
  chmod: (mode: number) => Promise<void>;
  stat: () => Promise<{ uid: number; mode: number }>;
};

export type TaskKickoffStoreDependencies = {
  lstat: (path: string) => Promise<{ isDirectory: () => boolean; isSymbolicLink: () => boolean }>;
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
  lstat: lstatPath,
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

async function createDirectoryIfMissing(
  path: string,
  dependencies: TaskKickoffStoreDependencies,
): Promise<void> {
  try {
    await dependencies.mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) throw error;
  }
}

async function requirePlainDirectory(
  path: string,
  dependencies: TaskKickoffStoreDependencies,
): Promise<void> {
  const stats = await dependencies.lstat(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Task kickoff store directory is unsafe");
  }
}

function storeRootComponents(storeRoot: string, includeRoot: boolean): string[] {
  const absoluteRoot = resolve(storeRoot);
  const parsed = parse(absoluteRoot);
  const components = absoluteRoot.slice(parsed.root.length).split(sep).filter(Boolean);
  let current = parsed.root;
  const paths = components.map((component) => {
    current = join(current, component);
    return current;
  });
  return includeRoot ? [parsed.root, ...paths] : paths;
}

function effectiveUserId(): number {
  const uid = process.geteuid?.();
  if (uid === undefined) throw new Error("Task kickoff store requires a POSIX user id");
  return uid;
}

function validatePosixRootComponent(
  stats: { uid: number; mode: number },
  uid: number,
  crossedStickyWritable: boolean,
): boolean {
  const groupOrOtherWritable = (stats.mode & 0o022) !== 0;
  const sticky = (stats.mode & 0o1000) !== 0;
  if (stats.uid !== 0 && stats.uid !== uid) {
    throw new Error("Task kickoff store directory has an unsafe owner");
  }
  if (crossedStickyWritable && (stats.uid !== uid || (stats.mode & 0o077) !== 0)) {
    throw new Error("Task kickoff store directory is not owner-only after a sticky parent");
  }
  if (groupOrOtherWritable && !sticky) {
    throw new Error("Task kickoff store directory is writable without sticky protection");
  }
  return crossedStickyWritable || (groupOrOtherWritable && sticky);
}

export async function prepareTaskKickoffStoreRootDirectory(
  storeRoot: string,
  platform: NodeJS.Platform,
  dependencies: TaskKickoffStoreDependencies,
): Promise<void> {
  if (storeRoot.trim().length === 0) throw new Error("Task kickoff store root is unsafe");
  const absoluteRoot = resolve(storeRoot);
  if (platform !== "win32" && absoluteRoot === parse(absoluteRoot).root) {
    throw new Error("Task kickoff store root is unsafe");
  }
  const components = storeRootComponents(storeRoot, platform !== "win32");
  if (components.length === 0) throw new Error("Task kickoff store root is unsafe");
  if (platform === "win32") {
    for (const component of components) {
      await createDirectoryIfMissing(component, dependencies);
      await requirePlainDirectory(component, dependencies);
    }
    return;
  }

  const uid = effectiveUserId();
  let crossedStickyWritable = false;
  let finalStats: { uid: number; mode: number } | undefined;
  for (const component of components) {
    await createDirectoryIfMissing(component, dependencies);
    const handle = await dependencies.openDirectory(component);
    await runWithHandle(handle, async () => {
      const stats = await handle.stat();
      crossedStickyWritable = validatePosixRootComponent(stats, uid, crossedStickyWritable);
      finalStats = stats;
      await handle.sync();
    });
  }
  if (finalStats === undefined || finalStats.uid !== uid || (finalStats.mode & 0o077) !== 0) {
    throw new Error("Task kickoff store root is not owner-only");
  }
}

async function prepareOwnerOnlyChild(
  parent: string,
  child: string,
  platform: NodeJS.Platform,
  dependencies: TaskKickoffStoreDependencies,
): Promise<string> {
  const path = join(parent, child);
  await createDirectoryIfMissing(path, dependencies);
  if (platform === "win32") {
    await requirePlainDirectory(path, dependencies);
    return path;
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
  platform: NodeJS.Platform,
  dependencies: TaskKickoffStoreDependencies,
): Promise<string> {
  if (platform === "win32")
    return prepareOwnerOnlyChild(storeRoot, "stats", platform, dependencies);
  await dependencies.syncDirectory(storeRoot);
  return prepareOwnerOnlyChild(storeRoot, "stats", platform, dependencies);
}

export async function prepareTaskKickoffClaimDirectory(
  storeRoot: string,
  platform: NodeJS.Platform,
  dependencies: TaskKickoffStoreDependencies,
): Promise<string> {
  const statsDirectory = await prepareStatsDirectory(storeRoot, platform, dependencies);
  return prepareOwnerOnlyChild(statsDirectory, "task-kickoff-sessions", platform, dependencies);
}

export async function prepareTaskKickoffPackDirectory(
  storeRoot: string,
  workspaceKey: string,
  platform: NodeJS.Platform,
  dependencies: TaskKickoffStoreDependencies,
): Promise<string> {
  const statsDirectory = await prepareStatsDirectory(storeRoot, platform, dependencies);
  const workspaceDirectory = await prepareOwnerOnlyChild(
    statsDirectory,
    workspaceKey,
    platform,
    dependencies,
  );
  return prepareOwnerOnlyChild(workspaceDirectory, "task-pack", platform, dependencies);
}

export async function prepareTaskKickoffIntentDirectory(
  storeRoot: string,
  workspaceKey: string,
  platform: NodeJS.Platform,
  dependencies: TaskKickoffStoreDependencies,
): Promise<string> {
  const statsDirectory = await prepareStatsDirectory(storeRoot, platform, dependencies);
  const workspaceDirectory = await prepareOwnerOnlyChild(
    statsDirectory,
    workspaceKey,
    platform,
    dependencies,
  );
  return prepareOwnerOnlyChild(workspaceDirectory, "intent", platform, dependencies);
}

export async function prepareTaskKickoffDirectories(
  storeRoot: string,
  workspaceKey: string,
  platform: NodeJS.Platform,
  dependencies: TaskKickoffStoreDependencies,
): Promise<TaskKickoffDirectories> {
  const statsDirectory = await prepareStatsDirectory(storeRoot, platform, dependencies);
  const claimDirectory = await prepareOwnerOnlyChild(
    statsDirectory,
    "task-kickoff-sessions",
    platform,
    dependencies,
  );
  const workspaceDirectory = await prepareOwnerOnlyChild(
    statsDirectory,
    workspaceKey,
    platform,
    dependencies,
  );
  const packDirectory = await prepareOwnerOnlyChild(
    workspaceDirectory,
    "task-pack",
    platform,
    dependencies,
  );
  return { claimDirectory, packDirectory };
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
