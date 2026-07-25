import { Lm1Error } from "./lm1-errors.js";
import { type Lm1Record, lm1RecordSchema } from "./lm1-model.js";
import { lm1RecordIdLocatorPath, lm1RecordPath } from "./lm1-paths.js";
import {
  type FileLm1Store,
  type Lm1StateIndexStore,
  MAX_LM1_DIRECT_ID_READS,
} from "./lm1-store-contracts.js";
import { closureSuccessorIds, listLm1Records, snapshotsForStateKeys } from "./lm1-store-index.js";
import {
  publishClosureMarker,
  publishNoClobber,
  publishRecordIdLocator,
  publishStateSnapshotCoverage,
  publishStateSnapshotPointer,
  reserveStateSnapshotRecordedAt,
} from "./lm1-store-publish.js";
import {
  type RecordIdLocator,
  assertLm1RecordIdentity,
  isNotFound,
  parseLm1Record,
  parseRecordIdLocator,
  recordIdLocatorSchema,
  sameImmutableRecord,
} from "./lm1-store-records.js";

export {
  type ClosureSuccessorLookup,
  type FileLm1Store,
  type Lm1StateIndexStore,
  type PublishedLm1Record,
  type StateSnapshotLookup,
  supportsLm1StateIndex,
} from "./lm1-store-contracts.js";

export function createFileLm1Store(input: { storeRoot: string }): FileLm1Store {
  const store: Lm1StateIndexStore = {
    publish(record) {
      const parsed = lm1RecordSchema.safeParse(record);
      if (!parsed.success) throw new Lm1Error("invalid_input", "Invalid LM1 record.");
      assertLm1RecordIdentity(parsed.data);
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
      const existing = parseLm1Record(path, {
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
        return parseLm1Record(path, { workspaceKey, kind, sourceDigest });
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
        record = parseLm1Record(
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
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > MAX_LM1_DIRECT_ID_READS ||
        entries.length > MAX_LM1_DIRECT_ID_READS
      ) {
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
        let locator: RecordIdLocator;
        try {
          locator = parseRecordIdLocator(
            lm1RecordIdLocatorPath(input.storeRoot, workspaceKey, expected.data.id),
            { workspaceKey, id: expected.data.id },
          );
        } catch (error) {
          if (isNotFound(error) || (error instanceof Lm1Error && error.code === "not_found")) {
            throw new Lm1Error("store_corrupt", "Long-memory direct record locator is missing.");
          }
          throw error;
        }
        if (
          locator.kind !== expected.data.kind ||
          locator.sourceDigest !== expected.data.sourceDigest
        ) {
          throw new Lm1Error("store_corrupt", "Long-memory record locator does not match request.");
        }
        let record: Lm1Record;
        try {
          record = parseLm1Record(
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
      return listLm1Records(input.storeRoot, workspaceKey, limit);
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
