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
import { type MemoryEntry, memoryEntrySchema } from "./memory-entry.js";
import { type Project, projectSchema } from "./project.js";
import { type Session, sessionSchema } from "./session.js";

export type StorePaths = {
  rootDir: string;
  projectsPath: string;
  sessionsPath: string;
  memoryDir: string;
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
    parseEntity(memoryEntrySchema, entry, join(paths.memoryDir, `${projectId}.jsonl`)),
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
        parseEntity(memoryEntrySchema, entry, filePath),
      );
    });
}

export function writeMemoryEntriesForProject(
  paths: StorePaths,
  projectId: ProjectId,
  entries: readonly MemoryEntry[],
): void {
  const content = entries.map((entry) => JSON.stringify(entry)).join("\n");
  atomicWriteFile(
    join(paths.memoryDir, `${projectId}.jsonl`),
    content.length === 0 ? "" : `${content}\n`,
  );
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
    // best-practice for atomic-update semantics. macOS + Linux supported in v0.1.
    const tempFd = openSync(tempPath, "r");
    try {
      fsyncSync(tempFd);
    } finally {
      closeSync(tempFd);
    }
    renameSync(tempPath, filePath);
    // Windows-friendly degradation: fsync on a directory fd may throw
    // EISDIR/EPERM/ENOTSUP on some filesystems. Swallow only those known
    // codes on the *directory* fsync; data fsync errors propagate.
    let dirFd: number | undefined;
    try {
      dirFd = openSync(parentDir, "r");
      fsyncSync(dirFd);
    } catch (dirErr) {
      const code = (dirErr as NodeJS.ErrnoException).code;
      if (code !== "EISDIR" && code !== "EPERM" && code !== "ENOTSUP") {
        throw dirErr;
      }
    } finally {
      if (dirFd !== undefined) {
        try {
          closeSync(dirFd);
        } catch {
          // Ignore close errors; the data is already on disk.
        }
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
