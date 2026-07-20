import { rankBm25 } from "@megasaver/retrieval";
import { Lm1Error } from "./lm1-errors.js";
import type {
  EvidenceEligibilityPort,
  Lm1RecallBundle,
  Lm1RecallRequest,
  Lm1Record,
  Lm1Snapshot,
} from "./lm1-model.js";
import {
  MAX_LM1_RECALL_TOKEN_BUDGET,
  evidenceEligibilityResultSchema,
  lm1RecallRequestSchema,
} from "./lm1-model.js";
import { compareSnapshotsForCurrent, selectStructuralSnapshotLeaves } from "./lm1-state.js";
import {
  type ClosureSuccessorLookup,
  type FileLm1Store,
  type StateSnapshotLookup,
  supportsLm1StateIndex,
} from "./lm1-store.js";

export const MAX_LM1_RECORDS_SCANNED = 10_000;
export const MAX_LM1_CANDIDATES = 1_000;
export const MAX_LM1_EVIDENCE_LOOKUPS = 512;
export const MAX_LM1_TOKEN_BUDGET = MAX_LM1_RECALL_TOKEN_BUDGET;

export type Lm1RecallService = {
  recall(request: Lm1RecallRequest): Promise<Lm1RecallBundle>;
};

function parseRecallRequest(request: Lm1RecallRequest): Lm1RecallRequest {
  let parsed: ReturnType<typeof lm1RecallRequestSchema.safeParse>;
  try {
    parsed = lm1RecallRequestSchema.safeParse(request);
  } catch {
    throw new Lm1Error("invalid_input", "Invalid LM1 recall request.");
  }
  if (!parsed.success) {
    throw new Lm1Error("invalid_input", "Invalid LM1 recall request.");
  }
  return parsed.data;
}

function compareRankedRecords(
  left: { score: number; record: Lm1Record },
  right: { score: number; record: Lm1Record },
): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.record.observedAt !== right.record.observedAt) {
    return right.record.observedAt.localeCompare(left.record.observedAt);
  }
  return left.record.id.localeCompare(right.record.id);
}

function compareSecondaryRecords(left: Lm1Record, right: Lm1Record): number {
  if (left.observedAt !== right.observedAt) {
    return right.observedAt.localeCompare(left.observedAt);
  }
  return left.id.localeCompare(right.id);
}

function requiredEvidenceIds(
  record: Lm1Record,
  recordsById: ReadonlyMap<string, Lm1Record>,
): readonly string[] {
  if (record.kind !== "state_transition") return record.evidenceIds;
  const pre = recordsById.get(record.preSnapshotId);
  const post = recordsById.get(record.postSnapshotId);
  if (pre === undefined || post === undefined) return [];
  return [...new Set([...record.evidenceIds, ...pre.evidenceIds, ...post.evidenceIds])].sort();
}

function assertEligible(
  workspaceKey: string,
  evidenceIds: readonly string[],
  result: unknown,
): boolean {
  let parsed: ReturnType<typeof evidenceEligibilityResultSchema.safeParse>;
  try {
    parsed = evidenceEligibilityResultSchema.safeParse(result);
  } catch {
    throw new Lm1Error("store_corrupt", "Evidence eligibility response is unreadable.");
  }
  if (!parsed.success) {
    throw new Lm1Error("store_corrupt", "Evidence eligibility response is invalid.");
  }
  return (
    parsed.data.length === evidenceIds.length &&
    parsed.data.every(
      (evidence, index) =>
        evidence.evidenceId === evidenceIds[index] &&
        evidence.workspaceKey === workspaceKey &&
        evidence.status === "available" &&
        !evidence.unresolvedHighRisk,
    )
  );
}

function mapEligibilityPortError(error: unknown): never {
  void error;
  throw new Lm1Error("store_corrupt", "Evidence eligibility port failed.");
}

type RankedRecord = { score: number; record: Lm1Record };
type RankedSnapshot = { score: number; record: Lm1Snapshot };
type StateGroup = { leaves: readonly Lm1Snapshot[]; incomplete: boolean };
type RecallCandidate =
  | { type: "state"; anchor: RankedSnapshot; group: StateGroup }
  | { type: "transition"; anchor: RankedRecord };
type SelectedCandidate = { anchor: RankedRecord; record: Lm1Record };
type OmittedCandidate = { id: string; reason: string; anchor: RankedRecord };

function stateGroupsByKey(
  snapshots: readonly Lm1Snapshot[],
  lookup: StateSnapshotLookup,
  closureLookup: ClosureSuccessorLookup,
): ReadonlyMap<string, StateGroup> {
  const snapshotsByStateKey = new Map<string, Lm1Snapshot[]>();
  for (const snapshot of snapshots) {
    const stateSnapshots = snapshotsByStateKey.get(snapshot.stateKey) ?? [];
    stateSnapshots.push(snapshot);
    snapshotsByStateKey.set(snapshot.stateKey, stateSnapshots);
  }
  const groups = new Map<string, StateGroup>();
  for (const stateKey of snapshotsByStateKey.keys()) {
    if (lookup.indexedStateKeys.has(stateKey)) {
      const indexedSnapshots = lookup.snapshotsByStateKey.get(stateKey) ?? [];
      const leaves = [...selectStructuralSnapshotLeaves(indexedSnapshots)].sort(
        compareSnapshotsForCurrent,
      );
      const indexedIds = new Set(indexedSnapshots.map((snapshot) => snapshot.id));
      const rawSnapshots = snapshotsByStateKey.get(stateKey) ?? [];
      const requiredClosureSuccessorIds = new Set(
        indexedSnapshots.flatMap(
          (snapshot) => closureLookup.successorIdsBySnapshotId.get(snapshot.id) ?? [],
        ),
      );
      groups.set(stateKey, {
        leaves,
        incomplete:
          lookup.incompleteStateKeys.has(stateKey) ||
          indexedSnapshots.some((snapshot) =>
            closureLookup.incompletePredecessorSnapshotIds.has(snapshot.id),
          ) ||
          rawSnapshots.some((snapshot) => !indexedIds.has(snapshot.id)) ||
          [...requiredClosureSuccessorIds].some(
            (successorSnapshotId) => !indexedIds.has(successorSnapshotId),
          ),
      });
      continue;
    }
    groups.set(stateKey, {
      leaves: [],
      incomplete: true,
    });
  }
  return groups;
}

function lexicalCandidates(
  ranked: readonly RankedRecord[],
  groupsByStateKey: ReadonlyMap<string, StateGroup>,
): readonly RecallCandidate[] {
  const candidates: RecallCandidate[] = [];
  const admittedStateKeys = new Set<string>();
  for (const hit of ranked) {
    if (hit.record.kind === "state_transition") {
      candidates.push({ type: "transition", anchor: hit });
      continue;
    }
    const snapshotHit: RankedSnapshot = { score: hit.score, record: hit.record };
    if (admittedStateKeys.has(snapshotHit.record.stateKey)) continue;
    const group = groupsByStateKey.get(snapshotHit.record.stateKey);
    if (group === undefined) continue;
    admittedStateKeys.add(snapshotHit.record.stateKey);
    candidates.push({ type: "state", anchor: snapshotHit, group });
  }
  return candidates;
}

export function createLm1RecallService(input: {
  store: FileLm1Store;
  evidenceEligibility: EvidenceEligibilityPort;
}): Lm1RecallService {
  return {
    async recall(request) {
      const parsedRequest = parseRecallRequest(request);
      const records = input.store.list(parsedRequest.workspaceKey, MAX_LM1_RECORDS_SCANNED);
      const recordsById = new Map(records.map((record) => [record.id, record]));
      const snapshots = records.filter(
        (record): record is Extract<Lm1Record, { kind: "state_snapshot" }> =>
          record.kind === "state_snapshot",
      );
      const transitions = records.filter((record) => record.kind === "state_transition");
      const candidates = [...snapshots, ...transitions].sort(compareSecondaryRecords);
      const candidatesById = new Map(candidates.map((record) => [record.id, record]));
      const ranked = rankBm25({
        query: parsedRequest.task,
        documents: candidates.map((record) => ({ id: record.id, text: record.text })),
        topN: Math.min(candidates.length || 1, MAX_LM1_CANDIDATES),
      })
        .filter((hit) => hit.score > 0)
        .flatMap((hit) => {
          const record = candidatesById.get(hit.id);
          return record === undefined ? [] : [{ score: hit.score, record }];
        })
        .sort(compareRankedRecords);
      const stateKeys = ranked.flatMap((candidate) =>
        candidate.record.kind === "state_snapshot" ? [candidate.record.stateKey] : [],
      );
      const stateIndexStore = supportsLm1StateIndex(input.store) ? input.store : undefined;
      const stateLookup =
        stateIndexStore === undefined
          ? {
              snapshotsByStateKey: new Map<string, readonly Lm1Snapshot[]>(),
              indexedStateKeys: new Set<string>(),
              incompleteStateKeys: new Set<string>(),
            }
          : stateIndexStore.stateSnapshotsForStateKeys(
              parsedRequest.workspaceKey,
              stateKeys,
              MAX_LM1_RECORDS_SCANNED,
            );
      const closureLookup = stateIndexStore?.closureSuccessorIds(
        parsedRequest.workspaceKey,
        [
          ...snapshots.map((snapshot) => snapshot.id),
          ...[...stateLookup.snapshotsByStateKey.values()].flatMap((stateSnapshots) =>
            stateSnapshots.map((snapshot) => snapshot.id),
          ),
        ],
        MAX_LM1_RECORDS_SCANNED,
      ) ?? {
        successorIdsBySnapshotId: new Map<string, readonly string[]>(),
        incompletePredecessorSnapshotIds: new Set<string>(),
      };
      const groupsByStateKey = stateGroupsByKey(snapshots, stateLookup, closureLookup);

      const items: { type: "text"; value: string; observationId: string }[] = [];
      const selected: { id: string; score: number; tokenCount: number }[] = [];
      const omitted: OmittedCandidate[] = [];
      const selectedCandidates: SelectedCandidate[] = [];
      const resolvedEvidenceIds = new Set<string>();

      const eligibilityFor = async (
        record: Lm1Record,
      ): Promise<"eligible" | "unavailable" | "limit"> => {
        const evidenceIds = requiredEvidenceIds(record, recordsById);
        if (evidenceIds.length === 0) return "unavailable";
        const newEvidenceIds = evidenceIds.filter(
          (evidenceId) => !resolvedEvidenceIds.has(evidenceId),
        );
        if (resolvedEvidenceIds.size + newEvidenceIds.length > MAX_LM1_EVIDENCE_LOOKUPS) {
          return "limit";
        }
        let eligibility: Awaited<ReturnType<EvidenceEligibilityPort["resolve"]>>;
        try {
          eligibility = await input.evidenceEligibility.resolve({
            workspaceKey: parsedRequest.workspaceKey,
            evidenceIds,
          });
        } catch (error) {
          mapEligibilityPortError(error);
        }
        for (const evidenceId of newEvidenceIds) resolvedEvidenceIds.add(evidenceId);
        return assertEligible(parsedRequest.workspaceKey, evidenceIds, eligibility)
          ? "eligible"
          : "unavailable";
      };

      for (const candidate of lexicalCandidates(ranked, groupsByStateKey)) {
        if (candidate.type === "transition") {
          const eligibility = await eligibilityFor(candidate.anchor.record);
          if (eligibility === "eligible") {
            selectedCandidates.push({ anchor: candidate.anchor, record: candidate.anchor.record });
            continue;
          }
          omitted.push({
            id: candidate.anchor.record.id,
            reason:
              eligibility === "limit" ? "omitted_evidence_limit" : "omitted_evidence_unavailable",
            anchor: candidate.anchor,
          });
          continue;
        }

        if (candidate.group.incomplete) {
          omitted.push({
            id: candidate.anchor.record.id,
            reason: "omitted_correction_chain_unavailable",
            anchor: candidate.anchor,
          });
          continue;
        }

        let winner: Lm1Snapshot | undefined;
        let limited = false;
        for (const leaf of candidate.group.leaves) {
          const eligibility = await eligibilityFor(leaf);
          if (eligibility === "eligible") {
            winner = leaf;
            break;
          }
          if (eligibility === "limit") {
            limited = true;
            break;
          }
        }
        if (winner !== undefined) {
          selectedCandidates.push({ anchor: candidate.anchor, record: winner });
          continue;
        }
        if (limited) {
          omitted.push({
            id: candidate.anchor.record.id,
            reason: "omitted_evidence_limit",
            anchor: candidate.anchor,
          });
          continue;
        }
        const current = candidate.group.leaves[0];
        if (current === undefined) throw new Lm1Error("store_corrupt", "State leaves are invalid.");
        omitted.push({
          id: current.id,
          reason:
            current.supersedesSnapshotId === null
              ? "omitted_evidence_unavailable"
              : "omitted_correction_chain_unavailable",
          anchor: candidate.anchor,
        });
      }

      selectedCandidates.sort((left, right) => compareRankedRecords(left.anchor, right.anchor));
      let usedTokens = 0;

      for (const candidate of selectedCandidates) {
        const tokenCount = Math.ceil(candidate.record.text.length / 4);
        if (usedTokens + tokenCount > parsedRequest.tokenBudget) {
          omitted.push({
            id: candidate.record.id,
            reason: "omitted_budget",
            anchor: candidate.anchor,
          });
          continue;
        }
        usedTokens += tokenCount;
        items.push({
          type: "text",
          value: candidate.record.text,
          observationId: candidate.record.id,
        });
        selected.push({ id: candidate.record.id, score: candidate.anchor.score, tokenCount });
      }

      omitted.sort((left, right) => compareRankedRecords(left.anchor, right.anchor));

      return {
        items,
        receipt: {
          selected,
          omitted: omitted.map(({ id, reason }) => ({ id, reason })),
          scannedRecordCount: records.length,
          candidateCount: ranked.length,
          evidenceLookupCount: resolvedEvidenceIds.size,
        },
      };
    },
  };
}
