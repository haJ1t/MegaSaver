import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { z } from "zod";
import { CorePersistenceError } from "./errors.js";
import {
  type OverlayMemoryEntry,
  backfillMemoryEntry,
  overlayMemoryEntrySchema,
} from "./memory-entry.js";
import { type OverlayTaskPlan, overlayTaskPlanSchema } from "./task-plan.js";

const IS_WIN32 = process.platform === "win32";

// liveSessionId === null is a workspace-level plan: it cannot collide with a
// transcript uuid (which never equals this reserved, key-safe segment).
const WORKSPACE_PLAN_SEGMENT = "_workspace";

export function readOverlayMemory(root: string, workspaceKey: string): OverlayMemoryEntry[] {
  const filePath = join(root, "memory", `${workspaceKey}.jsonl`);
  return readJsonLines(filePath).map((entry) =>
    parseEntity(overlayMemoryEntrySchema, backfillMemoryEntry(entry), filePath),
  );
}

export function writeOverlayMemory(
  root: string,
  workspaceKey: string,
  entries: readonly OverlayMemoryEntry[],
): void {
  writeJsonLines(join(root, "memory", `${workspaceKey}.jsonl`), entries);
}

export function readOverlayTaskPlans(
  root: string,
  workspaceKey: string,
  liveSessionId: string | null,
): OverlayTaskPlan[] {
  const filePath = taskPlanPath(root, workspaceKey, liveSessionId);
  return readJsonLines(filePath).map((entry) =>
    parseEntity(overlayTaskPlanSchema, entry, filePath),
  );
}

export function writeOverlayTaskPlans(
  root: string,
  workspaceKey: string,
  liveSessionId: string | null,
  plans: readonly OverlayTaskPlan[],
): void {
  writeJsonLines(taskPlanPath(root, workspaceKey, liveSessionId), plans);
}

function taskPlanPath(root: string, workspaceKey: string, liveSessionId: string | null): string {
  const segment = liveSessionId === null ? WORKSPACE_PLAN_SEGMENT : liveSessionId;
  return join(root, "tasks", workspaceKey, `${segment}.jsonl`);
}

// An empty set removes the file rather than leaving a zero-byte JSONL:
// readJsonLines treats an empty existing file as corrupt, so deleting the last
// entry must clear the file, not blank it. Mirrors writeMemoryEntriesForProject.
function writeJsonLines(filePath: string, entries: readonly unknown[]): void {
  if (entries.length === 0) {
    removeIfExists(filePath);
    return;
  }
  atomicWriteFile(filePath, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`);
}

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

    try {
      return JSON.parse(line) as unknown;
    } catch (error) {
      throw new CorePersistenceError("store_json_invalid", `Store JSON is invalid: ${filePath}`, {
        filePath,
        cause: error,
      });
    }
  });
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
    const tempFd = openSync(tempPath, "r+");
    try {
      fsyncSync(tempFd);
    } finally {
      closeSync(tempFd);
    }
    renameSync(tempPath, filePath);
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
