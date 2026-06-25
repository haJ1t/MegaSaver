import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READ_INDEX_FILENAME, atomicWriteFile } from "@megasaver/content-store";

export type ReadIndexEntry = { contentHash: string; chunkSetId: string };
type ReadIndex = Record<string, ReadIndexEntry>;

export function hashContent(raw: string | Buffer): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function hashPath(absolutePath: string): string {
  return createHash("sha256").update(absolutePath).digest("hex");
}

export function readIndexPath(sessionDir: string): string {
  return join(sessionDir, READ_INDEX_FILENAME);
}

export function loadReadIndex(sessionDir: string): ReadIndex {
  let raw: string;
  try {
    raw = readFileSync(readIndexPath(sessionDir), "utf8");
  } catch {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as ReadIndex;
  } catch {
    return {};
  }
}

export function recordRead(sessionDir: string, pathHash: string, entry: ReadIndexEntry): void {
  const index = loadReadIndex(sessionDir);
  index[pathHash] = entry;
  try {
    atomicWriteFile(readIndexPath(sessionDir), `${JSON.stringify(index, null, 2)}\n`);
  } catch {
    // best-effort: a failed record just means the next read is a miss.
  }
}
