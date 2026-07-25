import { readFileSync } from "node:fs";
import { z } from "zod";
import { Lm1Error } from "./lm1-errors.js";
import {
  canonicalCaptureDigest,
  deriveEvidenceBindingDigest,
  deriveLm1RecordId,
} from "./lm1-identity.js";
import { type Lm1Kind, type Lm1Record, lm1KindSchema, lm1RecordSchema } from "./lm1-model.js";
import { assertLm1PathIsNotSymlink } from "./lm1-paths.js";

export const recordIdLocatorSchema = z
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
export type RecordIdLocator = z.infer<typeof recordIdLocatorSchema>;

export function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

type RecordLocation = {
  workspaceKey: string;
  kind: Lm1Kind;
  sourceDigest: string;
};

export function parseLm1Record(path: string, location: RecordLocation): Lm1Record {
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
  assertLm1RecordIdentity(result.data);
  if (
    result.data.workspaceKey !== location.workspaceKey ||
    result.data.kind !== location.kind ||
    result.data.sourceDigest !== location.sourceDigest
  ) {
    throw new Lm1Error("store_corrupt", "Long-memory record does not match its path.");
  }
  return result.data;
}

export function parseRecordIdLocator(
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

export function assertLm1RecordIdentity(record: Lm1Record): void {
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

export function sameImmutableRecord(left: Lm1Record, right: Lm1Record): boolean {
  const { recordedAt: _leftRecordedAt, ...leftImmutable } = left;
  const { recordedAt: _rightRecordedAt, ...rightImmutable } = right;
  return JSON.stringify(leftImmutable) === JSON.stringify(rightImmutable);
}
