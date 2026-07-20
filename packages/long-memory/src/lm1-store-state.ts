import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { Lm1Error } from "./lm1-errors.js";
import type { Lm1Snapshot } from "./lm1-model.js";
import { assertLm1PathIsNotSymlink } from "./lm1-paths.js";

export const closureMarkerSchema = z
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
export type ClosureMarker = z.infer<typeof closureMarkerSchema>;

export const stateSnapshotPointerSchema = z
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
export type StateSnapshotPointer = z.infer<typeof stateSnapshotPointerSchema>;

export const stateSnapshotCoverageSchema = z
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
export type StateSnapshotCoverage = z.infer<typeof stateSnapshotCoverageSchema>;

export const stateSnapshotReservationSchema = z
  .object({
    workspaceKey: z.string().regex(/^[0-9a-f]{16}$/),
    sourceDigest: z.string().regex(/^[0-9a-f]{64}$/),
    recordedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type StateSnapshotReservation = z.infer<typeof stateSnapshotReservationSchema>;

const STATE_INDEX_TIME_OFFSET = 8_640_000_000_000_000n;

function readJson(path: string, message: string): unknown {
  assertLm1PathIsNotSymlink(path);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Lm1Error("store_corrupt", message);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Lm1Error("store_corrupt", message);
  }
}

export function parseClosureMarker(path: string, expected: ClosureMarker): ClosureMarker {
  const result = closureMarkerSchema.safeParse(
    readJson(path, "Long-memory closure marker is unreadable."),
  );
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

export function stateKeyDigest(stateKey: string): string {
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

export function stateSnapshotPointerName(pointer: StateSnapshotPointer): string {
  return `${stateIndexTimePart(pointer.observedAt)}-${stateIndexTimePart(pointer.recordedAt)}-${pointer.snapshotId}-${pointer.sourceDigest}.json`;
}

export function parseStateSnapshotPointer(
  path: string,
  name: string,
  workspaceKey: string,
  stateKey: string,
): StateSnapshotPointer {
  const result = stateSnapshotPointerSchema.safeParse(
    readJson(path, "Long-memory state index pointer is unreadable."),
  );
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

export function parseStateSnapshotCoverage(
  path: string,
  name: string,
  workspaceKey: string,
  stateKey: string,
): StateSnapshotCoverage {
  const result = stateSnapshotCoverageSchema.safeParse(
    readJson(path, "Long-memory state coverage is unreadable."),
  );
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

export function parseStateSnapshotReservation(
  path: string,
  expected: Pick<StateSnapshotReservation, "workspaceKey" | "sourceDigest">,
): StateSnapshotReservation {
  const result = stateSnapshotReservationSchema.safeParse(
    readJson(path, "Long-memory state reservation is unreadable."),
  );
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

export function pointerMatchesSnapshot(
  pointer: StateSnapshotPointer,
  snapshot: Lm1Snapshot,
): boolean {
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
