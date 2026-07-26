import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
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
    if (options.maxBytes !== undefined && statSync(path).size > options.maxBytes) {
      throw new RangeError("Vector sidecar exceeds the configured read limit.");
    }
    raw = readFileSync(path, "utf8");
  } catch {
    return new Map();
  }
  const out = new Map<string, Float32Array>();
  let records = 0;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    records += 1;
    if (options.maxRecords !== undefined && records > options.maxRecords) {
      throw new RangeError("Vector sidecar exceeds the configured record limit.");
    }
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
    out.set(rec.id, Float32Array.from(rec.vector));
  }
  return out;
}
