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
import type { ProjectId } from "@megasaver/shared";
import { z } from "zod";
import { CorePersistenceError } from "./errors.js";
import { type FailedAttempt, failedAttemptSchema } from "./failed-attempt.js";
import { type MemoryEntry, backfillMemoryEntry, memoryEntrySchema } from "./memory-entry.js";
import { type ProjectRule, projectRuleSchema } from "./project-rule.js";
import { type Project, projectSchema } from "./project.js";
import { type Session, sessionSchema } from "./session.js";

// Captured at module load: process.platform is immutable for the
// life of a process, so we read it once instead of per-write.
const IS_WIN32 = process.platform === "win32";

export type StorePaths = {
  rootDir: string;
  projectsPath: string;
  sessionsPath: string;
  memoryDir: string;
  projectRulesDir: string;
  failedAttemptsDir: string;
};

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
      return {
        rootDir: resolvedRootDir,
        projectsPath: join(resolvedRootDir, "projects.json"),
        sessionsPath: join(resolvedRootDir, "sessions.json"),
        memoryDir: join(resolvedRootDir, "memory"),
        projectRulesDir: join(resolvedRootDir, "project-rules"),
        failedAttemptsDir: join(resolvedRootDir, "failed-attempts"),
      };
    }

    if (error instanceof CorePersistenceError) {
      throw error;
    }

    throw new CorePersistenceError("store_root_invalid", "Store root is invalid.", {
      filePath: resolvedRootDir,
      cause: error,
    });
  }

  return {
    rootDir: resolvedRootDir,
    projectsPath: join(resolvedRootDir, "projects.json"),
    sessionsPath: join(resolvedRootDir, "sessions.json"),
    memoryDir: join(resolvedRootDir, "memory"),
    projectRulesDir: join(resolvedRootDir, "project-rules"),
    failedAttemptsDir: join(resolvedRootDir, "failed-attempts"),
  };
}

export function readProjects(paths: StorePaths): Project[] {
  return readJsonArray(paths.projectsPath).map((project) =>
    parseEntity(projectSchema, project, paths.projectsPath),
  );
}

export function writeProjects(paths: StorePaths, projects: readonly Project[]): void {
  atomicWriteFile(paths.projectsPath, `${JSON.stringify(projects, null, 2)}\n`);
}

export function readSessions(paths: StorePaths): Session[] {
  return readJsonArray(paths.sessionsPath).map((session) =>
    parseEntity(sessionSchema, session, paths.sessionsPath),
  );
}

export function writeSessions(paths: StorePaths, sessions: readonly Session[]): void {
  atomicWriteFile(paths.sessionsPath, `${JSON.stringify(sessions, null, 2)}\n`);
}

export function readMemoryEntriesForProject(
  paths: StorePaths,
  projectId: ProjectId,
): MemoryEntry[] {
  return readJsonLines(join(paths.memoryDir, `${projectId}.jsonl`)).map((entry) =>
    parseEntity(
      memoryEntrySchema,
      backfillMemoryEntry(entry),
      join(paths.memoryDir, `${projectId}.jsonl`),
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

export function writeMemoryEntriesForProject(
  paths: StorePaths,
  projectId: ProjectId,
  entries: readonly MemoryEntry[],
): void {
  const filePath = join(paths.memoryDir, `${projectId}.jsonl`);
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

export function readProjectRulesForProject(
  paths: StorePaths,
  projectId: ProjectId,
): ProjectRule[] {
  const filePath = join(paths.projectRulesDir, `${projectId}.jsonl`);
  return readJsonLines(filePath).map((entry) => parseEntity(projectRuleSchema, entry, filePath));
}

export function writeProjectRulesForProject(
  paths: StorePaths,
  projectId: ProjectId,
  rules: readonly ProjectRule[],
): void {
  const filePath = join(paths.projectRulesDir, `${projectId}.jsonl`);
  if (rules.length === 0) {
    removeIfExists(filePath);
    return;
  }
  atomicWriteFile(filePath, `${rules.map((rule) => JSON.stringify(rule)).join("\n")}\n`);
}

export function readFailedAttemptsForProject(
  paths: StorePaths,
  projectId: ProjectId,
): FailedAttempt[] {
  const filePath = join(paths.failedAttemptsDir, `${projectId}.jsonl`);
  return readJsonLines(filePath).map((entry) =>
    parseEntity(failedAttemptSchema, entry, filePath),
  );
}

export function writeFailedAttemptsForProject(
  paths: StorePaths,
  projectId: ProjectId,
  attempts: readonly FailedAttempt[],
): void {
  const filePath = join(paths.failedAttemptsDir, `${projectId}.jsonl`);
  if (attempts.length === 0) {
    removeIfExists(filePath);
    return;
  }
  atomicWriteFile(filePath, `${attempts.map((fa) => JSON.stringify(fa)).join("\n")}\n`);
}

// Mirrors the empty-set branch of writeMemoryEntriesForProject: an empty entity
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

function readJsonArray(filePath: string): unknown[] {
  try {
    return parseEntity(
      z.array(z.unknown()),
      parseJson(readFileSync(filePath, "utf8"), filePath),
      filePath,
    );
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    if (error instanceof CorePersistenceError) {
      throw error;
    }

    throw new CorePersistenceError("store_read_failed", "Store read failed.", {
      filePath,
      cause: error,
    });
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
