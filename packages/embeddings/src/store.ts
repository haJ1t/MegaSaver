import { randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

export type VectorEntry = { id: string; vector: number[] };
export type ReadVectorsOptions = {
  maxBytes?: number;
  maxRecords?: number;
  ids?: ReadonlySet<string>;
};

const vectorRecordSchema = z.object({
  id: z.string(),
  vector: z.array(z.number()),
});

function sameFileState(
  before: { size: number; dev: number; ino: number; mtimeMs: number; ctimeMs: number },
  after: { size: number; dev: number; ino: number; mtimeMs: number; ctimeMs: number },
): boolean {
  return (
    before.size === after.size &&
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

function atomicWrite(filePath: string, content: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tempPath = join(dir, `.${randomUUID()}.tmp`);
  const fd = openSync(tempPath, "w");
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tempPath, filePath);
}

export function writeVectors(path: string, entries: readonly VectorEntry[]): void {
  const body = entries.map((e) => JSON.stringify(e)).join("\n");
  atomicWrite(path, body.length === 0 ? "" : `${body}\n`);
}

export function readVectors(
  path: string,
  options: ReadVectorsOptions = {},
): Map<string, Float32Array> {
  let raw: string;
  try {
    if (options.maxBytes !== undefined) {
      const fd = openSync(path, "r");
      try {
        const before = fstatSync(fd);
        if (before.size > options.maxBytes) {
          throw new RangeError("Vector sidecar exceeds the configured byte limit.");
        }
        const bytes = Buffer.alloc(before.size);
        if (
          readSync(fd, bytes, 0, before.size, 0) !== before.size ||
          !sameFileState(before, fstatSync(fd))
        ) {
          throw new Error("Vector sidecar changed during bounded read.");
        }
        raw = bytes.toString("utf8");
      } finally {
        closeSync(fd);
      }
    } else {
      raw = readFileSync(path, "utf8");
    }
  } catch (error) {
    if (
      options.maxBytes !== undefined &&
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
    return new Map();
  }
  const out = new Map<string, Float32Array>();
  let selectedRecords = 0;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    const rec = vectorRecordSchema.parse(JSON.parse(line));
    if (options.ids !== undefined && !options.ids.has(rec.id)) continue;
    selectedRecords += 1;
    if (options.maxRecords !== undefined && selectedRecords > options.maxRecords) {
      throw new RangeError("Vector sidecar exceeds the configured selected-record limit.");
    }
    out.set(rec.id, Float32Array.from(rec.vector));
  }
  return out;
}

export function readVectorIds(path: string, maxBytes: number): Set<string> {
  let raw: string;
  try {
    const fd = openSync(path, "r");
    try {
      const before = fstatSync(fd);
      if (before.size > maxBytes) return new Set();
      const bytes = Buffer.alloc(before.size);
      if (
        readSync(fd, bytes, 0, before.size, 0) !== before.size ||
        !sameFileState(before, fstatSync(fd))
      ) {
        return new Set();
      }
      raw = bytes.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return new Set();
  }
  const ids = new Set<string>();
  try {
    for (const line of raw.split("\n")) {
      if (line.trim().length === 0) continue;
      const record = JSON.parse(line);
      if (typeof record !== "object" || record === null || typeof record.id !== "string") {
        return new Set();
      }
      ids.add(record.id);
    }
  } catch {
    return new Set();
  }
  return ids;
}
