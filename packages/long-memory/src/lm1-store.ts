import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  linkSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Lm1Error } from "./lm1-errors.js";
import {
  canonicalCaptureDigest,
  deriveEvidenceBindingDigest,
  deriveLm1RecordId,
} from "./lm1-identity.js";
import { type Lm1Kind, type Lm1Record, lm1RecordSchema } from "./lm1-model.js";
import { assertLm1PathIsNotSymlink, lm1RecordDirectory, lm1RecordPath } from "./lm1-paths.js";

export type PublishedLm1Record = { inserted: boolean; record: Lm1Record };

export type FileLm1Store = {
  publish(record: Lm1Record): PublishedLm1Record;
  getByDigest(workspaceKey: string, kind: Lm1Kind, sourceDigest: string): Lm1Record;
  getById(workspaceKey: string, id: string): Lm1Record;
  list(workspaceKey: string, limit: number): readonly Lm1Record[];
};

function fsyncFile(path: string): void {
  const descriptor = openSync(path, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function fsyncDirectory(path: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

type RecordLocation = {
  workspaceKey: string;
  kind: Lm1Kind;
  sourceDigest: string;
};

function parseRecord(path: string, location: RecordLocation): Lm1Record {
  assertLm1PathIsNotSymlink(path);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) throw new Lm1Error("not_found", "Long-memory record does not exist.");
    throw new Lm1Error("store_corrupt", "Long-memory record is unreadable.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Lm1Error("store_corrupt", "Long-memory record is unreadable.");
  }
  const result = lm1RecordSchema.safeParse(parsed);
  if (!result.success) throw new Lm1Error("store_corrupt", "Long-memory record is invalid.");
  assertRecordIdentity(result.data);
  if (
    result.data.workspaceKey !== location.workspaceKey ||
    result.data.kind !== location.kind ||
    result.data.sourceDigest !== location.sourceDigest
  ) {
    throw new Lm1Error("store_corrupt", "Long-memory record does not match its path.");
  }
  return result.data;
}

function assertRecordIdentity(record: Lm1Record): void {
  const sourceDigest = canonicalCaptureDigest(record);
  if (record.sourceDigest !== sourceDigest || record.canonicalCaptureDigest !== sourceDigest) {
    throw new Lm1Error("store_corrupt", "Long-memory record digest is invalid.");
  }
  if (record.id !== deriveLm1RecordId(record.workspaceKey, record.kind, sourceDigest)) {
    throw new Lm1Error("store_corrupt", "Long-memory record id is invalid.");
  }
  if (
    record.evidenceBindingDigest !==
    deriveEvidenceBindingDigest({
      workspaceKey: record.workspaceKey,
      canonicalCaptureDigest: record.canonicalCaptureDigest,
      evidenceIds: record.evidenceIds,
      evidenceDigests: record.evidenceDigests,
    })
  ) {
    throw new Lm1Error("store_corrupt", "Long-memory evidence binding is invalid.");
  }
}

function sameImmutableRecord(left: Lm1Record, right: Lm1Record): boolean {
  const { recordedAt: _leftRecordedAt, ...leftImmutable } = left;
  const { recordedAt: _rightRecordedAt, ...rightImmutable } = right;
  return JSON.stringify(leftImmutable) === JSON.stringify(rightImmutable);
}

function publishNoClobber(path: string, serialized: string): "created" | "exists" {
  const directory = dirname(path);
  const tempPath = join(directory, `.${randomUUID()}.tmp`);
  assertLm1PathIsNotSymlink(tempPath);
  try {
    writeFileSync(tempPath, serialized, { flag: "wx" });
    fsyncFile(tempPath);
    try {
      linkSync(tempPath, path);
      fsyncDirectory(directory);
      return "created";
    } catch (error) {
      if (isAlreadyExists(error)) return "exists";
      throw error;
    }
  } catch (error) {
    if (error instanceof Lm1Error) throw error;
    throw new Lm1Error("write_failed", "Long-memory record write failed.");
  } finally {
    rmSync(tempPath, { force: true });
  }
}

function listKind(
  storeRoot: string,
  workspaceKey: string,
  kind: Lm1Kind,
  limit: number,
): Lm1Record[] {
  let directory: string;
  let names: string[];
  try {
    directory = lm1RecordDirectory(storeRoot, workspaceKey, kind);
    names = readdirSync(directory);
  } catch (error) {
    if (error instanceof Lm1Error) throw error;
    throw new Lm1Error("store_corrupt", "Long-memory record directory is unreadable.");
  }
  return names
    .filter((name) => name.endsWith(".json"))
    .sort()
    .slice(0, limit)
    .map((name) =>
      parseRecord(join(directory, name), {
        workspaceKey,
        kind,
        sourceDigest: name.slice(0, -".json".length),
      }),
    );
}

function listRecords(storeRoot: string, workspaceKey: string, limit: number): readonly Lm1Record[] {
  const snapshots = listKind(storeRoot, workspaceKey, "state_snapshot", limit);
  const remaining = limit - snapshots.length;
  if (remaining === 0) return snapshots;
  return [...snapshots, ...listKind(storeRoot, workspaceKey, "state_transition", remaining)];
}

export function createFileLm1Store(input: { storeRoot: string }): FileLm1Store {
  return {
    publish(record) {
      const parsed = lm1RecordSchema.safeParse(record);
      if (!parsed.success) throw new Lm1Error("invalid_input", "Invalid LM1 record.");
      assertRecordIdentity(parsed.data);
      const path = lm1RecordPath(
        input.storeRoot,
        parsed.data.workspaceKey,
        parsed.data.kind,
        parsed.data.sourceDigest,
      );
      const published = publishNoClobber(path, `${JSON.stringify(parsed.data)}\n`);
      if (published === "created") return { inserted: true, record: parsed.data };
      const existing = parseRecord(path, {
        workspaceKey: parsed.data.workspaceKey,
        kind: parsed.data.kind,
        sourceDigest: parsed.data.sourceDigest,
      });
      if (!sameImmutableRecord(existing, parsed.data)) {
        throw new Lm1Error("store_corrupt", "Long-memory record conflicts with its digest path.");
      }
      return { inserted: false, record: existing };
    },
    getByDigest(workspaceKey, kind, sourceDigest) {
      const path = lm1RecordPath(input.storeRoot, workspaceKey, kind, sourceDigest);
      try {
        return parseRecord(path, { workspaceKey, kind, sourceDigest });
      } catch (error) {
        if (error instanceof Lm1Error) throw error;
        throw new Lm1Error("not_found", "Long-memory record does not exist.");
      }
    },
    getById(workspaceKey, id) {
      const found = listRecords(input.storeRoot, workspaceKey, Number.MAX_SAFE_INTEGER).find(
        (record) => record.id === id,
      );
      if (found === undefined)
        throw new Lm1Error("not_found", "Long-memory record does not exist.");
      return found;
    },
    list(workspaceKey, limit) {
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Lm1Error("invalid_input", "Invalid LM1 list limit.");
      }
      return listRecords(input.storeRoot, workspaceKey, limit);
    },
  };
}
