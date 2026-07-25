import { workspaceKeySchema } from "@megasaver/shared";
import { z } from "zod";
import { Lm1Error } from "./lm1-errors.js";
import { type Lm1Record, lm1RecordSchema } from "./lm1-model.js";
import { type CatalogLockGuard, acquireCatalogLock } from "./lm2-catalog-lock.js";
import {
  type Lm2Catalog,
  type Lm2CatalogEntry,
  MAX_LM2_CATALOG_ENTRIES,
  catalogStartIndex,
  nextCatalogCursor,
} from "./lm2-catalog-schema.js";
import {
  type CatalogStorage,
  closeCatalogStorage,
  openCatalogStorage,
  readStoredCatalog,
  replaceCatalogFile,
} from "./lm2-catalog-storage.js";
import { combineLm2CleanupFailures } from "./lm2-cleanup-errors.js";
import { Lm2Error } from "./lm2-errors.js";

export { MAX_LM2_CATALOG_BYTES, MAX_LM2_CATALOG_ENTRIES } from "./lm2-catalog-schema.js";
export type { Lm2CatalogEntry } from "./lm2-catalog-schema.js";

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
  if (error instanceof Lm1Error) {
    return new Lm2Error(
      error.code === "write_failed" ? "write_failed" : "store_corrupt",
      error.message,
    );
  }
  return new Lm2Error("store_corrupt", "LM2 candidate catalog is unreadable.");
}

function useLockedCatalog<T>(
  storeRoot: string,
  workspaceKey: string,
  work: (storage: CatalogStorage, guard: CatalogLockGuard, catalog: Lm2Catalog) => T,
): T {
  const storage = openCatalogStorage(storeRoot, workspaceKey);
  let guard: CatalogLockGuard | undefined;
  let result: T | undefined;
  let failure: unknown;
  try {
    guard = acquireCatalogLock(storage);
    guard.assertIntact();
    const stored = readStoredCatalog(storage);
    if (stored === null) throw new Lm2Error("store_corrupt", "LM2 candidate catalog is missing.");
    result = work(storage, guard, stored.value);
  } catch (error) {
    failure = error;
  }
  if (guard !== undefined) {
    try {
      guard.release();
    } catch (error) {
      failure = combineLm2CleanupFailures(failure, error);
    }
  }
  try {
    closeCatalogStorage(storage);
  } catch (error) {
    failure = combineLm2CleanupFailures(failure, error);
  }
  if (failure !== undefined) throw catalogError(failure);
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

function appendRecord(
  storage: CatalogStorage,
  guard: CatalogLockGuard,
  catalog: Lm2Catalog,
  record: Lm1Record,
): boolean {
  const prior = catalog.entries.find((entry) => entry.id === record.id);
  if (prior !== undefined) return sameCatalogTuple(prior, record);
  const captureSequence = (catalog.entries.at(-1)?.captureSequence ?? 0) + 1;
  const entries = [...catalog.entries, toCatalogEntry(record, captureSequence)].slice(
    -MAX_LM2_CATALOG_ENTRIES,
  );
  const stored = readStoredCatalog(storage);
  if (stored === null || stored.value.generation !== catalog.generation) {
    throw new Lm2Error("store_corrupt", "LM2 candidate catalog changed under lock.");
  }
  replaceCatalogFile(
    storage,
    stored,
    { schemaVersion: 2, generation: catalog.generation + 1, entries },
    () => guard.assertIntact(),
  );
  guard.assertIntact();
  return true;
}

export function createLm2CandidateCatalog({
  storeRoot,
}: {
  storeRoot: string;
}): Lm2CandidateCatalog {
  return {
    appendPublished(record) {
      const parsed = lm1RecordSchema.safeParse(record);
      if (!parsed.success) {
        throw new Lm2Error("invalid_input", "Invalid LM1 record for cataloging.");
      }
      try {
        return useLockedCatalog(storeRoot, parsed.data.workspaceKey, (storage, guard, catalog) =>
          appendRecord(storage, guard, catalog, parsed.data),
        );
      } catch {
        return false;
      }
    },
    page(request) {
      const parsed = pageRequestSchema.safeParse(request);
      if (!parsed.success) {
        throw new Lm2Error("invalid_input", "Invalid LM2 catalog page request.");
      }
      return useLockedCatalog(storeRoot, parsed.data.workspaceKey, (_storage, _guard, catalog) => {
        const start = catalogStartIndex(catalog, parsed.data.workspaceKey, parsed.data.cursor);
        const entries = catalog.entries.slice(start, start + parsed.data.limit);
        const next = catalog.entries[start + entries.length];
        return {
          generation: catalog.generation,
          entries,
          nextCursor:
            next === undefined
              ? null
              : nextCatalogCursor({
                  workspaceKey: parsed.data.workspaceKey,
                  generation: catalog.generation,
                  nextCaptureSequence: next.captureSequence,
                }),
        };
      });
    },
  };
}
