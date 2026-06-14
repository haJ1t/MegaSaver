import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { z } from "zod";
import { CorePersistenceError } from "./errors.js";
import { type FailedAttempt, failedAttemptSchema } from "./failed-attempt.js";
import { type MemoryEntry, backfillMemoryEntry, memoryEntrySchema } from "./memory-entry.js";
import { type ProjectRule, projectRuleSchema } from "./project-rule.js";
import { type TaskPlan, taskPlanSchema } from "./task-plan.js";
import { type ToolDefinition, toolDefinitionSchema } from "./tool-definition.js";

// Captured at module load: process.platform is immutable for the
// life of a process, so we read it once instead of per-write.
const IS_WIN32 = process.platform === "win32";

export type StorePaths = {
  rootDir: string;
  memoryDir: string;
  rulesDir: string;
  failedAttemptsDir: string;
  tasksDir: string;
  toolsDir: string;
  workspacesPath: string;
  migrationsDir: string;
};

function buildStorePaths(resolvedRootDir: string): StorePaths {
  return {
    rootDir: resolvedRootDir,
    memoryDir: join(resolvedRootDir, "memory"),
    rulesDir: join(resolvedRootDir, "rules"),
    failedAttemptsDir: join(resolvedRootDir, "failed-attempts"),
    tasksDir: join(resolvedRootDir, "tasks"),
    toolsDir: join(resolvedRootDir, "tools"),
    workspacesPath: join(resolvedRootDir, "workspaces.json"),
    migrationsDir: join(resolvedRootDir, ".migrations"),
  };
}

export function resolveStorePaths(rootDir: string): StorePaths {
  if (rootDir.trim().length === 0) {
    throw new CorePersistenceError("store_root_invalid", "Store root is invalid.");
  }

  const resolvedRootDir = resolve(rootDir);
  try {
    const rootStats = lstatSync(resolvedRootDir);
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
      throw new CorePersistenceError("store_root_invalid", "Store root is invalid.", {
        filePath: resolvedRootDir,
      });
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return buildStorePaths(resolvedRootDir);
    }

    if (error instanceof CorePersistenceError) {
      throw error;
    }

    throw new CorePersistenceError("store_root_invalid", "Store root is invalid.", {
      filePath: resolvedRootDir,
      cause: error,
    });
  }

  return buildStorePaths(resolvedRootDir);
}

export function readMemoryEntriesForWorkspace(
  paths: StorePaths,
  workspaceKey: string,
): MemoryEntry[] {
  return readJsonLines(join(paths.memoryDir, `${workspaceKey}.jsonl`)).map((entry) =>
    parseEntity(
      memoryEntrySchema,
      backfillMemoryEntry(entry),
      join(paths.memoryDir, `${workspaceKey}.jsonl`),
    ),
  );
}

export function readAllMemoryEntries(paths: StorePaths): MemoryEntry[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(paths.memoryDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw new CorePersistenceError("store_read_failed", "Store read failed.", {
      filePath: paths.memoryDir,
      cause: error,
    });
  }

  return fileNames
    .filter((fileName) => fileName.endsWith(".jsonl"))
    .flatMap((fileName) => {
      const filePath = join(paths.memoryDir, fileName);
      return readJsonLines(filePath).map((entry) =>
        parseEntity(memoryEntrySchema, backfillMemoryEntry(entry), filePath),
      );
    });
}

export function writeMemoryEntriesForWorkspace(
  paths: StorePaths,
  workspaceKey: string,
  entries: readonly MemoryEntry[],
): void {
  const filePath = join(paths.memoryDir, `${workspaceKey}.jsonl`);
  // An empty set removes the file rather than leaving a zero-byte JSONL:
  // readJsonLines treats an empty existing file as corrupt, so deleting the
  // last entry must clear the file, not blank it. An already-absent file
  // (ENOENT) is fine; any other failure (e.g. EPERM) must surface, not be
  // swallowed (§13: no silent error suppression).
  if (entries.length === 0) {
    try {
      rmSync(filePath);
    } catch (error) {
      if (!(isNodeError(error) && error.code === "ENOENT")) {
        throw new CorePersistenceError("store_write_failed", "Store write failed.", {
          filePath,
          cause: error,
        });
      }
    }
    return;
  }
  const content = entries.map((entry) => JSON.stringify(entry)).join("\n");
  atomicWriteFile(filePath, `${content}\n`);
}

export function readProjectRulesForWorkspace(
  paths: StorePaths,
  workspaceKey: string,
): ProjectRule[] {
  const filePath = join(paths.rulesDir, `${workspaceKey}.jsonl`);
  return readJsonLines(filePath).map((entry) => parseEntity(projectRuleSchema, entry, filePath));
}

export function readAllProjectRules(paths: StorePaths): ProjectRule[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(paths.rulesDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw new CorePersistenceError("store_read_failed", "Store read failed.", {
      filePath: paths.rulesDir,
      cause: error,
    });
  }

  return fileNames
    .filter((fileName) => fileName.endsWith(".jsonl"))
    .flatMap((fileName) => {
      const filePath = join(paths.rulesDir, fileName);
      return readJsonLines(filePath).map((entry) =>
        parseEntity(projectRuleSchema, entry, filePath),
      );
    });
}

export function writeProjectRulesForWorkspace(
  paths: StorePaths,
  workspaceKey: string,
  rules: readonly ProjectRule[],
): void {
  const filePath = join(paths.rulesDir, `${workspaceKey}.jsonl`);
  if (rules.length === 0) {
    removeIfExists(filePath);
    return;
  }
  atomicWriteFile(filePath, `${rules.map((rule) => JSON.stringify(rule)).join("\n")}\n`);
}

export function readFailedAttemptsForWorkspace(
  paths: StorePaths,
  workspaceKey: string,
): FailedAttempt[] {
  const filePath = join(paths.failedAttemptsDir, `${workspaceKey}.jsonl`);
  return readJsonLines(filePath).map((entry) => parseEntity(failedAttemptSchema, entry, filePath));
}

export function readAllFailedAttempts(paths: StorePaths): FailedAttempt[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(paths.failedAttemptsDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw new CorePersistenceError("store_read_failed", "Store read failed.", {
      filePath: paths.failedAttemptsDir,
      cause: error,
    });
  }

  return fileNames
    .filter((fileName) => fileName.endsWith(".jsonl"))
    .flatMap((fileName) => {
      const filePath = join(paths.failedAttemptsDir, fileName);
      return readJsonLines(filePath).map((entry) =>
        parseEntity(failedAttemptSchema, entry, filePath),
      );
    });
}

export function writeFailedAttemptsForWorkspace(
  paths: StorePaths,
  workspaceKey: string,
  attempts: readonly FailedAttempt[],
): void {
  const filePath = join(paths.failedAttemptsDir, `${workspaceKey}.jsonl`);
  if (attempts.length === 0) {
    removeIfExists(filePath);
    return;
  }
  atomicWriteFile(filePath, `${attempts.map((fa) => JSON.stringify(fa)).join("\n")}\n`);
}

export function readTaskPlansForWorkspace(paths: StorePaths, workspaceKey: string): TaskPlan[] {
  const filePath = join(paths.tasksDir, `${workspaceKey}.jsonl`);
  return readJsonLines(filePath).map((entry) => parseEntity(taskPlanSchema, entry, filePath));
}

export function readAllTaskPlans(paths: StorePaths): TaskPlan[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(paths.tasksDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw new CorePersistenceError("store_read_failed", "Store read failed.", {
      filePath: paths.tasksDir,
      cause: error,
    });
  }

  return fileNames
    .filter((fileName) => fileName.endsWith(".jsonl"))
    .flatMap((fileName) => {
      const filePath = join(paths.tasksDir, fileName);
      return readJsonLines(filePath).map((entry) => parseEntity(taskPlanSchema, entry, filePath));
    });
}

export function writeTaskPlansForWorkspace(
  paths: StorePaths,
  workspaceKey: string,
  plans: readonly TaskPlan[],
): void {
  const filePath = join(paths.tasksDir, `${workspaceKey}.jsonl`);
  if (plans.length === 0) {
    removeIfExists(filePath);
    return;
  }
  atomicWriteFile(filePath, `${plans.map((p) => JSON.stringify(p)).join("\n")}\n`);
}

export function readToolDefinitionsForWorkspace(
  paths: StorePaths,
  workspaceKey: string,
): ToolDefinition[] {
  const filePath = join(paths.toolsDir, `${workspaceKey}.jsonl`);
  return readJsonLines(filePath).map((entry) => parseEntity(toolDefinitionSchema, entry, filePath));
}

export function readAllToolDefinitions(paths: StorePaths): ToolDefinition[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(paths.toolsDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw new CorePersistenceError("store_read_failed", "Store read failed.", {
      filePath: paths.toolsDir,
      cause: error,
    });
  }

  return fileNames
    .filter((fileName) => fileName.endsWith(".jsonl"))
    .flatMap((fileName) => {
      const filePath = join(paths.toolsDir, fileName);
      return readJsonLines(filePath).map((entry) =>
        parseEntity(toolDefinitionSchema, entry, filePath),
      );
    });
}

export function writeToolDefinitionsForWorkspace(
  paths: StorePaths,
  workspaceKey: string,
  tools: readonly ToolDefinition[],
): void {
  const filePath = join(paths.toolsDir, `${workspaceKey}.jsonl`);
  if (tools.length === 0) {
    removeIfExists(filePath);
    return;
  }
  atomicWriteFile(filePath, `${tools.map((t) => JSON.stringify(t)).join("\n")}\n`);
}

// Mirrors the empty-set branch of writeMemoryEntriesForWorkspace: an empty entity
// set must delete the file (readJsonLines treats a zero-byte file as corrupt).
function removeIfExists(filePath: string): void {
  try {
    rmSync(filePath);
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT")) {
      throw new CorePersistenceError("store_write_failed", "Store write failed.", {
        filePath,
        cause: error,
      });
    }
  }
}

function readJsonLines(filePath: string): unknown[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw new CorePersistenceError("store_read_failed", "Store read failed.", {
      filePath,
      cause: error,
    });
  }

  if (content.length === 0) {
    throw new CorePersistenceError("store_json_invalid", `Store JSONL file is empty: ${filePath}`, {
      filePath,
    });
  }

  const lines = content.split("\n");
  if (content.endsWith("\n")) {
    lines.pop();
  }

  return lines.map((line) => {
    if (line.trim().length === 0) {
      throw new CorePersistenceError(
        "store_json_invalid",
        `Store JSONL has a blank line: ${filePath}`,
        { filePath },
      );
    }

    return parseJson(line, filePath);
  });
}

function parseJson(text: string, filePath: string): unknown {
  if (text.length === 0) {
    throw new CorePersistenceError("store_json_invalid", `Store file is empty: ${filePath}`, {
      filePath,
    });
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new CorePersistenceError("store_json_invalid", `Store JSON is invalid: ${filePath}`, {
      filePath,
      cause: error,
    });
  }
}

function parseEntity<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
  filePath: string,
): z.output<T> {
  try {
    return schema.parse(value);
  } catch (error) {
    throw new CorePersistenceError("store_entity_invalid", `Store entity is invalid: ${filePath}`, {
      filePath,
      cause: error,
    });
  }
}

function atomicWriteFile(filePath: string, content: string): void {
  const parentDir = dirname(filePath);
  const tempPath = join(parentDir, `.${randomUUID()}.tmp`);

  try {
    if (existsSync(parentDir) && lstatSync(parentDir).isSymbolicLink()) {
      throw new CorePersistenceError("store_write_failed", "Store write failed.", {
        filePath: parentDir,
      });
    }

    mkdirSync(parentDir, { recursive: true });
    writeFileSync(tempPath, content);
    // Durability: fsync the temp file before rename so its bytes are on disk,
    // then fsync the parent dir after rename so the link is durable. POSIX
    // best-practice for atomic-update semantics.
    // Open read-WRITE for the fsync: on Windows FlushFileBuffers requires a
    // write-capable handle (a read-only handle fails with EPERM/ACCESS_DENIED);
    // "r+" works on POSIX too. The temp file already exists (just written).
    const tempFd = openSync(tempPath, "r+");
    try {
      fsyncSync(tempFd);
    } finally {
      closeSync(tempFd);
    }
    renameSync(tempPath, filePath);
    // POSIX directory fsync: required on ext4/xfs/APFS so the rename
    // metadata is durable against kernel-panic / power-loss. On
    // Windows (NTFS) the rename's metadata is journaled and durable
    // without a caller-side flush; FlushFileBuffers on a directory
    // handle is a documented no-op, and openSync(dir, "r") itself
    // fails with EISDIR. We branch on platform rather than try/catch
    // so a real EPERM (sandbox, antivirus, seccomp) surfaces as a
    // durability failure instead of being silently swallowed.
    if (!IS_WIN32) {
      const dirFd = openSync(parentDir, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    }
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup failures; callers need the original write failure.
    }

    throw new CorePersistenceError("store_write_failed", "Store write failed.", {
      filePath,
      cause: error,
    });
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
