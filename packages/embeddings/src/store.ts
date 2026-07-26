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
        const before = fstatSync(fd).size;
        if (before > options.maxBytes) return new Map();
        const bytes = Buffer.alloc(before);
        if (readSync(fd, bytes, 0, before, 0) !== before || fstatSync(fd).size !== before) {
          return new Map();
        }
        raw = bytes.toString("utf8");
      } finally {
        closeSync(fd);
      }
    } else {
      raw = readFileSync(path, "utf8");
    }
  } catch {
    return new Map();
  }
  const out = new Map<string, Float32Array>();
  let selectedRecords = 0;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    const rawRecord = JSON.parse(line);
    if (
      options.ids !== undefined &&
      (typeof rawRecord !== "object" ||
        rawRecord === null ||
        !options.ids.has(rawRecord.id as string))
    ) {
      continue;
    }
    const rec = vectorRecordSchema.parse(rawRecord);
    selectedRecords += 1;
    if (options.maxRecords !== undefined && selectedRecords > options.maxRecords) {
      throw new RangeError("Vector sidecar exceeds the configured selected-record limit.");
    }
    out.set(rec.id, Float32Array.from(rec.vector));
  }
  return out;
}
