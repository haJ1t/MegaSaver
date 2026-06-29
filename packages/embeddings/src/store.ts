import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

export type VectorEntry = { id: string; vector: number[] };

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

export function readVectors(path: string): Map<string, Float32Array> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return new Map();
  }
  const out = new Map<string, Float32Array>();
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    const rec = vectorRecordSchema.parse(JSON.parse(line));
    out.set(rec.id, Float32Array.from(rec.vector));
  }
  return out;
}
