import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  linkSync,
  openSync,
  opendirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { Lm1Error } from "./lm1-errors.js";
import {
  canonicalCaptureDigest,
  deriveEvidenceBindingDigest,
  deriveLm1RecordId,
} from "./lm1-identity.js";
import {
  type Lm1Kind,
  type Lm1Record,
  type Lm1Snapshot,
  lm1KindSchema,
  lm1RecordSchema,
} from "./lm1-model.js";
import {
  assertLm1PathIsNotSymlink,
  existingLm1ClosureMarkerDirectory,
  existingLm1StateIndexDirectory,
  existingLm1StateSnapshotCoverageDirectory,
  lm1ClosureMarkerPath,
  lm1RecordDirectory,
  lm1RecordIdLocatorPath,
  lm1RecordPath,
  lm1StateIndexPointerPath,
  lm1StateSnapshotCoveragePath,
  lm1StateSnapshotReservationPath,
} from "./lm1-paths.js";

export type PublishedLm1Record = { inserted: boolean; record: Lm1Record };

export type StateSnapshotLookup = {
  snapshotsByStateKey: ReadonlyMap<string, readonly Lm1Snapshot[]>;
  indexedStateKeys: ReadonlySet<string>;
  incompleteStateKeys: ReadonlySet<string>;
};

export type ClosureSuccessorLookup = {
  successorIdsBySnapshotId: ReadonlyMap<string, readonly string[]>;
  incompletePredecessorSnapshotIds: ReadonlySet<string>;
};

export type FileLm1Store = {
  publish(record: Lm1Record): PublishedLm1Record;
  getByDigest(workspaceKey: string, kind: Lm1Kind, sourceDigest: string): Lm1Record;
  getById(workspaceKey: string, id: string): Lm1Record;
  getByIds?(
    workspaceKey: string,
    entries: readonly Pick<Lm1Record, "id" | "kind" | "sourceDigest">[],
    limit: number,
  ): readonly Lm1Record[];
  list(workspaceKey: string, limit: number): readonly Lm1Record[];
};

export type Lm1StateIndexStore = FileLm1Store & {
  closureSuccessorIds(
    workspaceKey: string,
    snapshotIds: readonly string[],
    limit?: number,
  ): ClosureSuccessorLookup;
  stateSnapshotsForStateKeys(
    workspaceKey: string,
    stateKeys: readonly string[],
    limit: number,
  ): StateSnapshotLookup;
};

export function supportsLm1StateIndex(store: FileLm1Store): store is Lm1StateIndexStore {
  const candidate = store as Partial<Lm1StateIndexStore>;
  return (
    typeof candidate.closureSuccessorIds === "function" &&
    typeof candidate.stateSnapshotsForStateKeys === "function"
  );
}

const closureMarkerSchema = z
  .object({
    workspaceKey: z.string().regex(/^[0-9a-f]{16}$/),
    predecessorSnapshotId: z
      .string()
      .uuid()
      .refine((value) => value === value.toLowerCase(), "id must be lowercase"),
    successorSnapshotId: z
      .string()
      .uuid()
      .refine((value) => value === value.toLowerCase(), "id must be lowercase"),
  })
  .strict();
type ClosureMarker = z.infer<typeof closureMarkerSchema>;

const stateSnapshotPointerSchema = z
  .object({
    workspaceKey: z.string().regex(/^[0-9a-f]{16}$/),
    stateKey: z.string().min(1).max(512),
    snapshotId: z
      .string()
      .uuid()
      .refine((value) => value === value.toLowerCase(), "id must be lowercase"),
    sourceDigest: z.string().regex(/^[0-9a-f]{64}$/),
    observedAt: z.string().datetime({ offset: true }),
    recordedAt: z.string().datetime({ offset: true }),
    supersedesSnapshotId: z
      .string()
      .uuid()
      .refine((value) => value === value.toLowerCase(), "id must be lowercase")
      .nullable(),
  })
  .strict();
type StateSnapshotPointer = z.infer<typeof stateSnapshotPointerSchema>;

const stateSnapshotCoverageSchema = z
  .object({
    workspaceKey: z.string().regex(/^[0-9a-f]{16}$/),
    stateKey: z.string().min(1).max(512),
    snapshotId: z
      .string()
      .uuid()
      .refine((value) => value === value.toLowerCase(), "id must be lowercase"),
    sourceDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
type StateSnapshotCoverage = z.infer<typeof stateSnapshotCoverageSchema>;

const stateSnapshotReservationSchema = z
  .object({
    workspaceKey: z.string().regex(/^[0-9a-f]{16}$/),
    sourceDigest: z.string().regex(/^[0-9a-f]{64}$/),
    recordedAt: z.string().datetime({ offset: true }),
  })
  .strict();
type StateSnapshotReservation = z.infer<typeof stateSnapshotReservationSchema>;

const recordIdLocatorSchema = z
  .object({
    workspaceKey: z.string().regex(/^[0-9a-f]{16}$/),
    id: z
      .string()
      .uuid()
      .refine((value) => value === value.toLowerCase(), "id must be lowercase"),
    kind: lm1KindSchema,
    sourceDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
type RecordIdLocator = z.infer<typeof recordIdLocatorSchema>;
const STATE_INDEX_TIME_OFFSET = 8_640_000_000_000_000n;

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

function parseRecordIdLocator(
  path: string,
  expected: Pick<RecordIdLocator, "workspaceKey" | "id">,
): RecordIdLocator {
  assertLm1PathIsNotSymlink(path);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) throw new Lm1Error("not_found", "Long-memory record does not exist.");
    throw new Lm1Error("store_corrupt", "Long-memory record locator is unreadable.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Lm1Error("store_corrupt", "Long-memory record locator is unreadable.");
  }
  const result = recordIdLocatorSchema.safeParse(parsed);
  if (
    !result.success ||
    result.data.workspaceKey !== expected.workspaceKey ||
    result.data.id !== expected.id
  ) {
    throw new Lm1Error("store_corrupt", "Long-memory record locator is invalid.");
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

function parseClosureMarker(path: string, expected: ClosureMarker): ClosureMarker {
  assertLm1PathIsNotSymlink(path);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Lm1Error("store_corrupt", "Long-memory closure marker is unreadable.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Lm1Error("store_corrupt", "Long-memory closure marker is unreadable.");
  }
  const result = closureMarkerSchema.safeParse(parsed);
  if (
    !result.success ||
    result.data.workspaceKey !== expected.workspaceKey ||
    result.data.predecessorSnapshotId !== expected.predecessorSnapshotId ||
    result.data.successorSnapshotId !== expected.successorSnapshotId
  ) {
    throw new Lm1Error("store_corrupt", "Long-memory closure marker is invalid.");
  }
  return result.data;
}

function stateKeyDigest(stateKey: string): string {
  return createHash("sha256")
    .update("megasaver.long-memory.lm1.state-index.v1\0")
    .update(stateKey)
    .digest("hex");
}

function stateIndexTimePart(value: string): string {
  const timestamp = BigInt(new Date(value).getTime());
  return (STATE_INDEX_TIME_OFFSET - timestamp).toString().padStart(17, "0");
}

function isCanonicalTimestamp(value: string): boolean {
  try {
    return value === new Date(value).toISOString();
  } catch {
    return false;
  }
}

function stateSnapshotPointerName(pointer: StateSnapshotPointer): string {
  return `${stateIndexTimePart(pointer.observedAt)}-${stateIndexTimePart(pointer.recordedAt)}-${pointer.snapshotId}-${pointer.sourceDigest}.json`;
}

function parseStateSnapshotPointer(
  path: string,
  name: string,
  workspaceKey: string,
  stateKey: string,
): StateSnapshotPointer {
  assertLm1PathIsNotSymlink(path);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Lm1Error("store_corrupt", "Long-memory state index pointer is unreadable.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Lm1Error("store_corrupt", "Long-memory state index pointer is unreadable.");
  }
  const result = stateSnapshotPointerSchema.safeParse(parsed);
  if (
    !result.success ||
    result.data.workspaceKey !== workspaceKey ||
    result.data.stateKey !== stateKey ||
    !isCanonicalTimestamp(result.data.observedAt) ||
    !isCanonicalTimestamp(result.data.recordedAt) ||
    stateSnapshotPointerName(result.data) !== name
  ) {
    throw new Lm1Error("store_corrupt", "Long-memory state index pointer is invalid.");
  }
  return result.data;
}

function parseStateSnapshotCoverage(
  path: string,
  name: string,
  workspaceKey: string,
  stateKey: string,
): StateSnapshotCoverage {
  assertLm1PathIsNotSymlink(path);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Lm1Error("store_corrupt", "Long-memory state coverage is unreadable.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Lm1Error("store_corrupt", "Long-memory state coverage is unreadable.");
  }
  const result = stateSnapshotCoverageSchema.safeParse(parsed);
  if (
    !result.success ||
    result.data.workspaceKey !== workspaceKey ||
    result.data.stateKey !== stateKey ||
    `${result.data.sourceDigest}.json` !== name
  ) {
    throw new Lm1Error("store_corrupt", "Long-memory state coverage is invalid.");
  }
  return result.data;
}

function parseStateSnapshotReservation(
  path: string,
  expected: Pick<StateSnapshotReservation, "workspaceKey" | "sourceDigest">,
): StateSnapshotReservation {
  assertLm1PathIsNotSymlink(path);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Lm1Error("store_corrupt", "Long-memory state reservation is unreadable.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Lm1Error("store_corrupt", "Long-memory state reservation is unreadable.");
  }
  const result = stateSnapshotReservationSchema.safeParse(parsed);
  if (
    !result.success ||
    result.data.workspaceKey !== expected.workspaceKey ||
    result.data.sourceDigest !== expected.sourceDigest ||
    !isCanonicalTimestamp(result.data.recordedAt)
  ) {
    throw new Lm1Error("store_corrupt", "Long-memory state reservation is invalid.");
  }
  return result.data;
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

type BoundedJsonNames = { names: readonly string[]; hasMore: boolean };

function listBoundedJsonNames(directory: string, limit: number, label: string): BoundedJsonNames {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Lm1Error("invalid_input", "Invalid long-memory directory read limit.");
  }
  const names: string[] = [];
  try {
    const handle = opendirSync(directory);
    try {
      while (true) {
        const entry = handle.readSync();
        if (entry === null) break;
        if (!entry.name.endsWith(".json")) continue;
        if (names.length === limit) return { names: names.sort(), hasMore: true };
        names.push(entry.name);
      }
    } finally {
      handle.closeSync();
    }
  } catch {
    throw new Lm1Error("store_corrupt", `Long-memory ${label} directory is unreadable.`);
  }
  return { names: names.sort(), hasMore: false };
}

function listKind(
  storeRoot: string,
  workspaceKey: string,
  kind: Lm1Kind,
  limit: number,
): Lm1Record[] {
  let directory: string;
  try {
    directory = lm1RecordDirectory(storeRoot, workspaceKey, kind);
  } catch (error) {
    if (error instanceof Lm1Error) throw error;
    throw new Lm1Error("store_corrupt", "Long-memory record directory is unreadable.");
  }
  return listBoundedJsonNames(directory, limit, "record").names.map((name) =>
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

function publishClosureMarker(storeRoot: string, record: Lm1Record): void {
  if (record.kind !== "state_snapshot" || record.supersedesSnapshotId === null) return;
  const marker = {
    workspaceKey: record.workspaceKey,
    predecessorSnapshotId: record.supersedesSnapshotId,
    successorSnapshotId: record.id,
  };
  const path = lm1ClosureMarkerPath(
    storeRoot,
    marker.workspaceKey,
    marker.predecessorSnapshotId,
    marker.successorSnapshotId,
  );
  if (publishNoClobber(path, `${JSON.stringify(marker)}\n`) === "exists") {
    parseClosureMarker(path, marker);
  }
}

function publishRecordIdLocator(storeRoot: string, record: Lm1Record): void {
  const locator: RecordIdLocator = {
    workspaceKey: record.workspaceKey,
    id: record.id,
    kind: record.kind,
    sourceDigest: record.sourceDigest,
  };
  const path = lm1RecordIdLocatorPath(storeRoot, locator.workspaceKey, locator.id);
  if (publishNoClobber(path, `${JSON.stringify(locator)}\n`) === "exists") {
    const existing = parseRecordIdLocator(path, locator);
    if (existing.kind !== locator.kind || existing.sourceDigest !== locator.sourceDigest) {
      throw new Lm1Error("store_corrupt", "Long-memory record locator conflicts with its record.");
    }
  }
}

function stateSnapshotPointer(record: Lm1Snapshot): StateSnapshotPointer {
  return {
    workspaceKey: record.workspaceKey,
    stateKey: record.stateKey,
    snapshotId: record.id,
    sourceDigest: record.sourceDigest,
    observedAt: record.observedAt,
    recordedAt: record.recordedAt,
    supersedesSnapshotId: record.supersedesSnapshotId,
  };
}

function publishStateSnapshotPointer(storeRoot: string, record: Lm1Record): void {
  if (record.kind !== "state_snapshot") return;
  const pointer = stateSnapshotPointer(record);
  const name = stateSnapshotPointerName(pointer);
  const path = lm1StateIndexPointerPath(
    storeRoot,
    pointer.workspaceKey,
    stateKeyDigest(pointer.stateKey),
    name,
  );
  if (publishNoClobber(path, `${JSON.stringify(pointer)}\n`) === "exists") {
    parseStateSnapshotPointer(path, name, pointer.workspaceKey, pointer.stateKey);
  }
}

function stateSnapshotCoverage(record: Lm1Snapshot): StateSnapshotCoverage {
  return {
    workspaceKey: record.workspaceKey,
    stateKey: record.stateKey,
    snapshotId: record.id,
    sourceDigest: record.sourceDigest,
  };
}

function publishStateSnapshotCoverage(storeRoot: string, record: Lm1Record): void {
  if (record.kind !== "state_snapshot") return;
  const coverage = stateSnapshotCoverage(record);
  const path = lm1StateSnapshotCoveragePath(
    storeRoot,
    coverage.workspaceKey,
    stateKeyDigest(coverage.stateKey),
    coverage.sourceDigest,
  );
  if (publishNoClobber(path, `${JSON.stringify(coverage)}\n`) === "exists") {
    const existing = parseStateSnapshotCoverage(
      path,
      `${coverage.sourceDigest}.json`,
      coverage.workspaceKey,
      coverage.stateKey,
    );
    if (existing.snapshotId !== coverage.snapshotId) {
      throw new Lm1Error(
        "store_corrupt",
        "Long-memory state coverage conflicts with its snapshot.",
      );
    }
  }
}

function reserveStateSnapshotRecordedAt(storeRoot: string, record: Lm1Snapshot): Lm1Snapshot {
  const reservation: StateSnapshotReservation = {
    workspaceKey: record.workspaceKey,
    sourceDigest: record.sourceDigest,
    recordedAt: record.recordedAt,
  };
  const path = lm1StateSnapshotReservationPath(
    storeRoot,
    reservation.workspaceKey,
    reservation.sourceDigest,
  );
  if (publishNoClobber(path, `${JSON.stringify(reservation)}\n`) === "created") return record;
  const durableReservation = parseStateSnapshotReservation(path, reservation);
  return { ...record, recordedAt: durableReservation.recordedAt };
}

function pointerMatchesSnapshot(pointer: StateSnapshotPointer, snapshot: Lm1Snapshot): boolean {
  return (
    pointer.workspaceKey === snapshot.workspaceKey &&
    pointer.stateKey === snapshot.stateKey &&
    pointer.snapshotId === snapshot.id &&
    pointer.sourceDigest === snapshot.sourceDigest &&
    pointer.observedAt === snapshot.observedAt &&
    pointer.recordedAt === snapshot.recordedAt &&
    pointer.supersedesSnapshotId === snapshot.supersedesSnapshotId
  );
}

function snapshotsForStateKeys(
  storeRoot: string,
  workspaceKey: string,
  stateKeys: readonly string[],
  limit: number,
): StateSnapshotLookup {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Lm1Error("invalid_input", "Invalid LM1 state index limit.");
  }
  const snapshotsByStateKey = new Map<string, readonly Lm1Snapshot[]>();
  const indexedStateKeys = new Set<string>();
  const incompleteStateKeys = new Set<string>();
  let remaining = limit;
  for (const stateKey of [...new Set(stateKeys)]) {
    const directory = existingLm1StateIndexDirectory(
      storeRoot,
      workspaceKey,
      stateKeyDigest(stateKey),
    );
    if (directory === null) continue;
    indexedStateKeys.add(stateKey);
    if (remaining === 0) {
      incompleteStateKeys.add(stateKey);
      snapshotsByStateKey.set(stateKey, []);
      continue;
    }
    const pointerNames = listBoundedJsonNames(directory, remaining, "state index");
    const coverageDirectory = existingLm1StateSnapshotCoverageDirectory(
      storeRoot,
      workspaceKey,
      stateKeyDigest(stateKey),
    );
    let coverageNames: BoundedJsonNames | undefined;
    if (coverageDirectory === null) {
      incompleteStateKeys.add(stateKey);
    } else {
      coverageNames = listBoundedJsonNames(coverageDirectory, remaining, "state coverage");
    }
    if (pointerNames.hasMore || coverageNames?.hasMore) {
      incompleteStateKeys.add(stateKey);
      snapshotsByStateKey.set(stateKey, []);
      continue;
    }
    const coverageBySourceDigest = new Map<string, StateSnapshotCoverage>();
    for (const name of coverageNames?.names ?? []) {
      const coverage = parseStateSnapshotCoverage(
        join(coverageDirectory as string, name),
        name,
        workspaceKey,
        stateKey,
      );
      coverageBySourceDigest.set(coverage.sourceDigest, coverage);
    }
    const pointers: StateSnapshotPointer[] = [];
    for (const name of pointerNames.names) {
      pointers.push(parseStateSnapshotPointer(join(directory, name), name, workspaceKey, stateKey));
    }
    const pointerSourceDigests = new Set(pointers.map((pointer) => pointer.sourceDigest));
    if (
      pointerSourceDigests.size !== pointerNames.names.length ||
      coverageBySourceDigest.size !== (coverageNames?.names.length ?? 0) ||
      pointerSourceDigests.size !== coverageBySourceDigest.size ||
      pointers.some((pointer) => {
        const coverage = coverageBySourceDigest.get(pointer.sourceDigest);
        return coverage === undefined || coverage.snapshotId !== pointer.snapshotId;
      })
    ) {
      incompleteStateKeys.add(stateKey);
    }
    const snapshots: Lm1Snapshot[] = [];
    for (const pointer of pointers) {
      try {
        const snapshot = parseRecord(
          lm1RecordPath(storeRoot, workspaceKey, "state_snapshot", pointer.sourceDigest),
          { workspaceKey, kind: "state_snapshot", sourceDigest: pointer.sourceDigest },
        );
        if (snapshot.kind !== "state_snapshot" || !pointerMatchesSnapshot(pointer, snapshot)) {
          throw new Lm1Error(
            "store_corrupt",
            "Long-memory state pointer does not match its snapshot.",
          );
        }
        snapshots.push(snapshot);
      } catch (error) {
        if (error instanceof Lm1Error && error.code === "not_found") {
          incompleteStateKeys.add(stateKey);
          continue;
        }
        throw error;
      }
    }
    remaining -= pointerNames.names.length;
    snapshotsByStateKey.set(stateKey, snapshots);
  }
  return { snapshotsByStateKey, indexedStateKeys, incompleteStateKeys };
}

function closureSuccessorIds(
  storeRoot: string,
  workspaceKey: string,
  snapshotIds: readonly string[],
  limit = 10_000,
): ClosureSuccessorLookup {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Lm1Error("invalid_input", "Invalid LM1 closure read limit.");
  }
  const successorsBySnapshotId = new Map<string, readonly string[]>();
  const incompletePredecessorSnapshotIds = new Set<string>();
  let remaining = limit;
  for (const predecessorSnapshotId of [...new Set(snapshotIds)]) {
    const directory = existingLm1ClosureMarkerDirectory(
      storeRoot,
      workspaceKey,
      predecessorSnapshotId,
    );
    if (directory === null) continue;
    if (remaining === 0) {
      incompletePredecessorSnapshotIds.add(predecessorSnapshotId);
      continue;
    }
    const names = listBoundedJsonNames(directory, remaining, "closure");
    if (names.hasMore) {
      incompletePredecessorSnapshotIds.add(predecessorSnapshotId);
      continue;
    }
    const successorSnapshotIds = names.names.map((name) => {
      const successorSnapshotId = name.slice(0, -".json".length);
      parseClosureMarker(join(directory, name), {
        workspaceKey,
        predecessorSnapshotId,
        successorSnapshotId,
      });
      return successorSnapshotId;
    });
    if (successorSnapshotIds.length > 0) {
      successorsBySnapshotId.set(predecessorSnapshotId, successorSnapshotIds);
    }
    remaining -= successorSnapshotIds.length;
  }
  return { successorIdsBySnapshotId: successorsBySnapshotId, incompletePredecessorSnapshotIds };
}

export function createFileLm1Store(input: { storeRoot: string }): FileLm1Store {
  const store: Lm1StateIndexStore = {
    publish(record) {
      const parsed = lm1RecordSchema.safeParse(record);
      if (!parsed.success) throw new Lm1Error("invalid_input", "Invalid LM1 record.");
      assertRecordIdentity(parsed.data);
      const durableCandidate =
        parsed.data.kind === "state_snapshot"
          ? reserveStateSnapshotRecordedAt(input.storeRoot, parsed.data)
          : parsed.data;
      publishRecordIdLocator(input.storeRoot, durableCandidate);
      publishStateSnapshotCoverage(input.storeRoot, durableCandidate);
      publishClosureMarker(input.storeRoot, durableCandidate);
      publishStateSnapshotPointer(input.storeRoot, durableCandidate);
      const path = lm1RecordPath(
        input.storeRoot,
        durableCandidate.workspaceKey,
        durableCandidate.kind,
        durableCandidate.sourceDigest,
      );
      const published = publishNoClobber(path, `${JSON.stringify(durableCandidate)}\n`);
      if (published === "created") return { inserted: true, record: durableCandidate };
      const existing = parseRecord(path, {
        workspaceKey: durableCandidate.workspaceKey,
        kind: durableCandidate.kind,
        sourceDigest: durableCandidate.sourceDigest,
      });
      if (!sameImmutableRecord(existing, durableCandidate)) {
        throw new Lm1Error("store_corrupt", "Long-memory record conflicts with its digest path.");
      }
      if (
        durableCandidate.kind === "state_snapshot" &&
        existing.recordedAt !== durableCandidate.recordedAt
      ) {
        throw new Lm1Error(
          "store_corrupt",
          "Long-memory state record does not match its recorded-at reservation.",
        );
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
      const locator = parseRecordIdLocator(
        lm1RecordIdLocatorPath(input.storeRoot, workspaceKey, id),
        { workspaceKey, id },
      );
      let record: Lm1Record;
      try {
        record = parseRecord(
          lm1RecordPath(input.storeRoot, workspaceKey, locator.kind, locator.sourceDigest),
          { workspaceKey, kind: locator.kind, sourceDigest: locator.sourceDigest },
        );
      } catch (error) {
        if (error instanceof Lm1Error && error.code === "not_found") {
          throw new Lm1Error("store_corrupt", "Long-memory record locator has no record.");
        }
        throw error;
      }
      if (record.id !== id) {
        throw new Lm1Error(
          "store_corrupt",
          "Long-memory record locator does not match its record.",
        );
      }
      return record;
    },
    getByIds(workspaceKey, entries, limit) {
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Lm1Error("invalid_input", "Invalid LM1 direct record read limit.");
      }
      const records: Lm1Record[] = [];
      for (const entry of entries.slice(0, limit)) {
        const expected = recordIdLocatorSchema.safeParse({
          workspaceKey,
          id: entry.id,
          kind: entry.kind,
          sourceDigest: entry.sourceDigest,
        });
        if (!expected.success) {
          throw new Lm1Error("invalid_input", "Invalid LM1 direct record locator.");
        }
        const locator = parseRecordIdLocator(
          lm1RecordIdLocatorPath(input.storeRoot, workspaceKey, expected.data.id),
          { workspaceKey, id: expected.data.id },
        );
        if (
          locator.kind !== expected.data.kind ||
          locator.sourceDigest !== expected.data.sourceDigest
        ) {
          throw new Lm1Error("store_corrupt", "Long-memory record locator does not match request.");
        }
        let record: Lm1Record;
        try {
          record = parseRecord(
            lm1RecordPath(input.storeRoot, workspaceKey, locator.kind, locator.sourceDigest),
            { workspaceKey, kind: locator.kind, sourceDigest: locator.sourceDigest },
          );
        } catch (error) {
          if (error instanceof Lm1Error && error.code === "not_found") {
            throw new Lm1Error("store_corrupt", "Long-memory record locator has no record.");
          }
          throw error;
        }
        if (
          record.id !== expected.data.id ||
          record.workspaceKey !== workspaceKey ||
          record.kind !== expected.data.kind ||
          record.sourceDigest !== expected.data.sourceDigest
        ) {
          throw new Lm1Error("store_corrupt", "Long-memory direct record does not match request.");
        }
        records.push(record);
      }
      return records;
    },
    list(workspaceKey, limit) {
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Lm1Error("invalid_input", "Invalid LM1 list limit.");
      }
      return listRecords(input.storeRoot, workspaceKey, limit);
    },
    closureSuccessorIds(workspaceKey, snapshotIds, limit) {
      return closureSuccessorIds(input.storeRoot, workspaceKey, snapshotIds, limit);
    },
    stateSnapshotsForStateKeys(workspaceKey, stateKeys, limit) {
      return snapshotsForStateKeys(input.storeRoot, workspaceKey, stateKeys, limit);
    },
  };
  return store;
}
