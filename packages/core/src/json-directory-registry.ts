import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import type { ProjectId } from "@megasaver/shared";
import { CorePersistenceError, CoreRegistryError } from "./errors.js";
import {
  readAllMemoryEntries,
  readMemoryEntriesForProject,
  readProjects,
  readSessions,
  resolveStorePaths,
  writeMemoryEntriesForProject,
  writeProjects,
  writeSessions,
} from "./json-directory-store.js";
import { type MemoryEntry, memoryEntrySchema } from "./memory-entry.js";
import { type Project, projectSchema } from "./project.js";
import type { CoreRegistry } from "./registry.js";
import { type Session, sessionSchema } from "./session.js";

export type JsonDirectoryCoreRegistryOptions = {
  rootDir: string;
};

function isLockHolderAlive(lockPath: string): boolean {
  let raw: string;
  try {
    raw = readFileSync(lockPath, "utf8");
  } catch {
    // lockfile vanished between EEXIST and read — treat as gone
    return false;
  }
  const pid = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    // malformed payload — treat as stale, reclaim
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false; // confirmed dead
    }
    // EPERM (process exists but signal blocked), other → conservative alive
    return true;
  }
}

// Single-developer scale: a .lock file in rootDir acts as a mutex for
// create operations that follow a read-check-write pattern (TOCTOU).
// PID is written into the lock file; a stale holder (crashed process)
// is detected via process.kill(pid, 0) and the lock is reclaimed.
function withDirLock<T>(rootDir: string, fn: () => T): T {
  const lockPath = path.join(rootDir, ".projects.lock");
  mkdirSync(rootDir, { recursive: true });
  const deadline = Date.now() + 5000; // 5s acquire timeout
  let fd: number | undefined;
  while (Date.now() < deadline) {
    try {
      fd = openSync(lockPath, "wx");
      writeSync(fd, String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new CorePersistenceError("store_write_failed", "Failed to acquire registry lock.", {
          cause: error,
          filePath: lockPath,
        });
      }
      if (!isLockHolderAlive(lockPath)) {
        try {
          rmSync(lockPath, { force: true });
          continue; // reclaim succeeded — immediate retry
        } catch {
          // reclaim failed (e.g. permission denied) — fall through to backoff
        }
      }
      const buf = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(buf, 0, 0, 50);
    }
  }
  if (fd === undefined) {
    throw new CorePersistenceError("store_write_failed", "Timed out acquiring registry lock.", {
      filePath: lockPath,
    });
  }
  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
    } catch {}
    try {
      rmSync(lockPath, { force: true });
    } catch {}
  }
}

export function createJsonDirectoryCoreRegistry(
  options: JsonDirectoryCoreRegistryOptions,
): CoreRegistry {
  const paths = resolveStorePaths(options.rootDir);

  const requireProject = (projectId: ProjectId): Project => {
    const project = readProjects(paths).find((candidate) => candidate.id === projectId);
    if (!project) {
      throw new CoreRegistryError("project_not_found", `Project does not exist: ${projectId}`);
    }

    return projectSchema.parse(project);
  };

  return {
    createProject(project) {
      return withDirLock(options.rootDir, () => {
        const parsed = projectSchema.parse(project);
        const projects = readProjects(paths);
        if (projects.some((existingProject) => existingProject.id === parsed.id)) {
          throw new CoreRegistryError(
            "project_already_exists",
            `Project already exists: ${parsed.id}`,
          );
        }

        writeProjects(paths, [...projects, parsed]);
        return projectSchema.parse(parsed);
      });
    },

    getProject(id) {
      const project = readProjects(paths).find((candidate) => candidate.id === id);
      return project ? projectSchema.parse(project) : null;
    },

    listProjects() {
      return readProjects(paths).map((project) => projectSchema.parse(project));
    },

    createSession(session) {
      return withDirLock(options.rootDir, () => {
        const parsed = sessionSchema.parse(session);
        const sessions = readSessions(paths);
        if (sessions.some((existingSession) => existingSession.id === parsed.id)) {
          throw new CoreRegistryError(
            "session_already_exists",
            `Session already exists: ${parsed.id}`,
          );
        }

        requireProject(parsed.projectId);
        writeSessions(paths, [...sessions, parsed]);
        return sessionSchema.parse(parsed);
      });
    },

    getSession(id) {
      const session = readSessions(paths).find((candidate) => candidate.id === id);
      return session ? sessionSchema.parse(session) : null;
    },

    listSessions(projectId) {
      requireProject(projectId);
      return readSessions(paths)
        .filter((session) => session.projectId === projectId)
        .map((session) => sessionSchema.parse(session));
    },

    endSession(id, opts) {
      // No requireProject check: a session existing in the registry implies its project
      // existed at create-time, and the registry does not delete projects.
      return withDirLock(options.rootDir, () => {
        const sessions = readSessions(paths);
        const existingRaw = sessions.find((candidate) => candidate.id === id);
        if (!existingRaw) {
          throw new CoreRegistryError("session_not_found", `Session does not exist: ${id}`);
        }
        const existing = sessionSchema.parse(existingRaw);
        if (existing.endedAt !== null) {
          throw new CoreRegistryError("session_already_ended", `Session already ended: ${id}`);
        }
        const updated = sessionSchema.parse({ ...existing, endedAt: opts.endedAt });
        const next = sessions.map((session) => (session.id === id ? updated : session));
        writeSessions(paths, next);
        return updated;
      });
    },

    updateSession() {
      throw new Error("updateSession not implemented yet (T1 stub; lands in T3)");
    },

    createMemoryEntry(entry) {
      return withDirLock(options.rootDir, () => {
        const parsed = memoryEntrySchema.parse(entry);
        if (readAllMemoryEntries(paths).some((existingEntry) => existingEntry.id === parsed.id)) {
          throw new CoreRegistryError(
            "memory_entry_already_exists",
            `Memory entry already exists: ${parsed.id}`,
          );
        }

        requireProject(parsed.projectId);

        if (parsed.scope === "session" && parsed.sessionId !== null) {
          const session = readSessions(paths).find(
            (candidate) => candidate.id === parsed.sessionId,
          );
          if (!session) {
            throw new CoreRegistryError(
              "session_not_found",
              `Session does not exist: ${parsed.sessionId}`,
            );
          }

          if (session.projectId !== parsed.projectId) {
            throw new CoreRegistryError(
              "session_project_mismatch",
              `Session ${parsed.sessionId} does not belong to project ${parsed.projectId}`,
            );
          }
        }

        const projectEntries = readMemoryEntriesForProject(paths, parsed.projectId);
        writeMemoryEntriesForProject(paths, parsed.projectId, [...projectEntries, parsed]);
        return memoryEntrySchema.parse(parsed);
      });
    },

    getMemoryEntry(id) {
      const entry = readAllMemoryEntries(paths).find((candidate) => candidate.id === id);
      return entry ? memoryEntrySchema.parse(entry) : null;
    },

    listMemoryEntries(projectId) {
      requireProject(projectId);
      return readMemoryEntriesForProject(paths, projectId).map((entry) =>
        memoryEntrySchema.parse(entry),
      );
    },
  };
}
