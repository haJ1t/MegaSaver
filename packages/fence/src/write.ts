import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { YAMLSeq, parseDocument } from "yaml";
import { FenceError } from "./error.js";
import {
  FENCE_FILE_NAME,
  type FenceEntry,
  type FenceFile,
  parseFenceFile,
  serializeFenceFile,
} from "./fence-file.js";

function writeTmpThenRename(targetPath: string, content: string): void {
  const tmpPath = `${targetPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmpPath, content, "utf8");
    renameSync(tmpPath, targetPath);
  } catch (err: unknown) {
    try {
      unlinkSync(tmpPath);
    } catch {}
    const message = err instanceof Error ? err.message : String(err);
    throw new FenceError("io_failed", `failed to write ${targetPath}: ${message}`, {
      cause: err,
    });
  }
}

export function writeFenceFileAtomic(dir: string, file: FenceFile): void {
  const content = serializeFenceFile(file);
  const targetPath = join(dir, FENCE_FILE_NAME);
  writeTmpThenRename(targetPath, content);
}

export function appendFenceEntries(dir: string, additions: readonly FenceEntry[]): void {
  if (additions.length === 0) return;
  const path = join(dir, FENCE_FILE_NAME);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new FenceError("io_failed", `unable to read ${path}: ${message}`, {
      cause: err,
    });
  }

  const doc = parseDocument(raw);
  if (doc.errors.length > 0) {
    throw new FenceError("schema_invalid", `invalid yaml in ${path}: ${doc.errors[0]?.message}`);
  }

  let entries = doc.get("entries");
  if (!entries) {
    entries = doc.createNode([]);
    doc.set("entries", entries);
  }
  if (!(entries instanceof YAMLSeq)) {
    throw new FenceError("schema_invalid", "entries is not a sequence");
  }

  for (const entry of additions) {
    entries.add(doc.createNode(entry));
  }

  // Validate the mutated document before writing
  parseFenceFile(doc.toJS());
  writeTmpThenRename(path, doc.toString());
}

export function appendFenceAllow(dir: string, glob: string): void {
  const path = join(dir, FENCE_FILE_NAME);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new FenceError("io_failed", `unable to read ${path}: ${message}`, {
      cause: err,
    });
  }

  const doc = parseDocument(raw);
  if (doc.errors.length > 0) {
    throw new FenceError("schema_invalid", `invalid yaml in ${path}: ${doc.errors[0]?.message}`);
  }

  let allow = doc.get("allow");
  if (!allow) {
    allow = doc.createNode([]);
    doc.set("allow", allow);
  }
  if (!(allow instanceof YAMLSeq)) {
    throw new FenceError("schema_invalid", "allow is not a sequence");
  }

  allow.add(doc.createNode(glob));

  // Validate the mutated document before writing
  parseFenceFile(doc.toJS());
  writeTmpThenRename(path, doc.toString());
}
