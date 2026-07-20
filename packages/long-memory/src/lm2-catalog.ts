import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { workspaceKeySchema } from "@megasaver/shared";
import { flockSync } from "fs-ext";
import { z } from "zod";
import { Lm1Error } from "./lm1-errors.js";
import { type Lm1Record, lm1KindSchema, lm1RecordSchema } from "./lm1-model.js";
import { assertLm1PathIsNotSymlink } from "./lm1-paths.js";
import { Lm2Error } from "./lm2-errors.js";
import { lm2CandidateCatalogLockPath, lm2CandidateCatalogPath } from "./lm2-paths.js";

export const MAX_LM2_CATALOG_ENTRIES = 10_000;
export const MAX_LM2_CATALOG_BYTES = 4 * 1024 * 1024;

const lowercaseUuidSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase(), "id must be lowercase");
const sourceDigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const catalogEntrySchema = z
  .object({
    id: lowercaseUuidSchema,
    sourceDigest: sourceDigestSchema,
    kind: lm1KindSchema,
    observedAt: z.string().datetime({ offset: true }),
    captureSequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type Lm2CatalogEntry = z.infer<typeof catalogEntrySchema>;

const catalogSchema = z
  .object({
    schemaVersion: z.literal(1),
    generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    entries: z.array(catalogEntrySchema).max(MAX_LM2_CATALOG_ENTRIES),
  })
  .strict();
type Lm2Catalog = z.infer<typeof catalogSchema>;

const cursorSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaceKey: workspaceKeySchema,
    generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    nextCaptureSequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
type CatalogCursor = z.infer<typeof cursorSchema>;

const pageRequestSchema = z
  .object({
    workspaceKey: workspaceKeySchema,
    cursor: z.string().min(1).max(4_096).nullable(),
    limit: z.number().int().min(1).max(MAX_LM2_CATALOG_ENTRIES),
  })
  .strict();

export type Lm2CatalogPage = {
  generation: number;
  entries: readonly Lm2CatalogEntry[];
  nextCursor: string | null;
};

export type Lm2CandidateCatalog = {
  appendPublished(record: Lm1Record): boolean;
  page(input: { workspaceKey: string; cursor: string | null; limit: number }): Lm2CatalogPage;
};

function catalogError(error: unknown): Lm2Error {
  if (error instanceof Lm2Error) return error;
  if (error instanceof Lm1Error)
    return new Lm2Error(
      error.code === "write_failed" ? "write_failed" : "store_corrupt",
      error.message,
    );
  return new Lm2Error("store_corrupt", "LM2 candidate catalog is unreadable.");
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

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

function isCanonicalTimestamp(value: string): boolean {
  try {
    return value === new Date(value).toISOString();
  } catch {
    return false;
  }
}

function validateCatalog(catalog: Lm2Catalog): Lm2Catalog {
  const seenIds = new Set<string>();
  let expectedSequence: number | undefined;
  for (const entry of catalog.entries) {
    if (
      seenIds.has(entry.id) ||
      (expectedSequence !== undefined && entry.captureSequence !== expectedSequence) ||
      !isCanonicalTimestamp(entry.observedAt)
    ) {
      throw new Lm2Error("store_corrupt", "LM2 candidate catalog is invalid.");
    }
    seenIds.add(entry.id);
    expectedSequence = entry.captureSequence + 1;
  }
  return catalog;
}

function serializeCatalog(catalog: Lm2Catalog): string {
  const serialized = `${JSON.stringify(catalog)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_LM2_CATALOG_BYTES) {
    throw new Lm2Error("write_failed", "LM2 candidate catalog exceeds its storage limit.");
  }
  return serialized;
}

function readCatalog(storeRoot: string, workspaceKey: string): Lm2Catalog {
  const path = lm2CandidateCatalogPath(storeRoot, workspaceKey);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return { schemaVersion: 1, generation: 0, entries: [] };
    throw catalogError(error);
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_LM2_CATALOG_BYTES) {
    throw new Lm2Error("store_corrupt", "LM2 candidate catalog exceeds its storage limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Lm2Error("store_corrupt", "LM2 candidate catalog is unreadable.");
  }
  const result = catalogSchema.safeParse(parsed);
  if (!result.success || raw !== `${JSON.stringify(result.data)}\n`) {
    throw new Lm2Error("store_corrupt", "LM2 candidate catalog is invalid.");
  }
  return validateCatalog(result.data);
}

function writeCatalog(storeRoot: string, workspaceKey: string, catalog: Lm2Catalog): void {
  const path = lm2CandidateCatalogPath(storeRoot, workspaceKey);
  const directory = dirname(path);
  const serialized = serializeCatalog(validateCatalog(catalog));
  const tempPath = join(directory, `.${randomUUID()}.tmp`);
  assertLm1PathIsNotSymlink(tempPath);
  try {
    writeFileSync(tempPath, serialized, { flag: "wx", mode: 0o600 });
    fsyncFile(tempPath);
    assertLm1PathIsNotSymlink(path);
    renameSync(tempPath, path);
    fsyncDirectory(directory);
  } catch (error) {
    throw catalogError(error);
  } finally {
    rmSync(tempPath, { force: true });
  }
}

function withCatalogLock<T>(storeRoot: string, workspaceKey: string, work: () => T): T {
  const path = lm2CandidateCatalogLockPath(storeRoot, workspaceKey);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "a+", 0o600);
    flockSync(descriptor, "exnb");
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch (closeError) {
        throw catalogError(closeError);
      }
    }
    throw catalogError(error);
  }
  let result: T | undefined;
  let workFailure: unknown;
  try {
    result = work();
  } catch (error) {
    workFailure = error;
  }
  let releaseFailure: unknown;
  try {
    flockSync(descriptor, "un");
  } catch (error) {
    releaseFailure = error;
  }
  try {
    closeSync(descriptor);
  } catch (error) {
    releaseFailure ??= error;
  }
  if (releaseFailure !== undefined) throw catalogError(releaseFailure);
  if (workFailure !== undefined) throw workFailure;
  return result as T;
}

function toCatalogEntry(record: Lm1Record, captureSequence: number): Lm2CatalogEntry {
  return {
    id: record.id,
    sourceDigest: record.sourceDigest,
    kind: record.kind,
    observedAt: record.observedAt,
    captureSequence,
  };
}

function sameCatalogTuple(entry: Lm2CatalogEntry, record: Lm1Record): boolean {
  return (
    entry.id === record.id &&
    entry.sourceDigest === record.sourceDigest &&
    entry.kind === record.kind &&
    entry.observedAt === record.observedAt
  );
}

function encodeCursor(cursor: CatalogCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string): CatalogCursor {
  let raw: string;
  try {
    raw = Buffer.from(value, "base64url").toString("utf8");
  } catch {
    throw new Lm2Error("invalid_input", "Invalid LM2 catalog cursor.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Lm2Error("invalid_input", "Invalid LM2 catalog cursor.");
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success || value !== encodeCursor(result.data)) {
    throw new Lm2Error("invalid_input", "Invalid LM2 catalog cursor.");
  }
  return result.data;
}

function startIndexForCursor(
  catalog: Lm2Catalog,
  workspaceKey: string,
  cursor: string | null,
): number {
  if (cursor === null) return 0;
  const decoded = decodeCursor(cursor);
  if (decoded.workspaceKey !== workspaceKey) {
    throw new Lm2Error("invalid_input", "LM2 catalog cursor workspace does not match request.");
  }
  if (decoded.generation > catalog.generation) {
    throw new Lm2Error("cursor_expired", "LM2 catalog cursor generation is unavailable.");
  }
  const index = catalog.entries.findIndex(
    (entry) => entry.captureSequence === decoded.nextCaptureSequence,
  );
  if (index >= 0) return index;
  const terminalSequence = (catalog.entries.at(-1)?.captureSequence ?? 0) + 1;
  if (decoded.nextCaptureSequence === terminalSequence) return catalog.entries.length;
  throw new Lm2Error("cursor_expired", "LM2 catalog cursor is outside the retained window.");
}

export function createLm2CandidateCatalog({
  storeRoot,
}: {
  storeRoot: string;
}): Lm2CandidateCatalog {
  return {
    appendPublished(record) {
      const parsed = lm1RecordSchema.safeParse(record);
      if (!parsed.success)
        throw new Lm2Error("invalid_input", "Invalid LM1 record for cataloging.");
      try {
        return withCatalogLock(storeRoot, parsed.data.workspaceKey, () => {
          const catalog = readCatalog(storeRoot, parsed.data.workspaceKey);
          const prior = catalog.entries.find((entry) => entry.id === parsed.data.id);
          if (prior !== undefined) return sameCatalogTuple(prior, parsed.data);
          const captureSequence = (catalog.entries.at(-1)?.captureSequence ?? 0) + 1;
          const entries = [...catalog.entries, toCatalogEntry(parsed.data, captureSequence)].slice(
            -MAX_LM2_CATALOG_ENTRIES,
          );
          writeCatalog(storeRoot, parsed.data.workspaceKey, {
            schemaVersion: 1,
            generation: catalog.generation + 1,
            entries,
          });
          return true;
        });
      } catch {
        return false;
      }
    },
    page(request) {
      const parsed = pageRequestSchema.safeParse(request);
      if (!parsed.success) throw new Lm2Error("invalid_input", "Invalid LM2 catalog page request.");
      const catalog = readCatalog(storeRoot, parsed.data.workspaceKey);
      const start = startIndexForCursor(catalog, parsed.data.workspaceKey, parsed.data.cursor);
      const entries = catalog.entries.slice(start, start + parsed.data.limit);
      const next = catalog.entries[start + entries.length];
      return {
        generation: catalog.generation,
        entries,
        nextCursor:
          next === undefined
            ? null
            : encodeCursor({
                schemaVersion: 1,
                workspaceKey: parsed.data.workspaceKey,
                generation: catalog.generation,
                nextCaptureSequence: next.captureSequence,
              }),
      };
    },
  };
}
