import { Lm1Error } from "./lm1-errors.js";
import type {
  EvidenceEligibilityPort,
  Lm1RecallBundle,
  Lm1RecallRequest,
  Lm1Record,
  Lm1Snapshot,
} from "./lm1-model.js";
import { evidenceEligibilityResultSchema, lm1RecallRequestSchema } from "./lm1-model.js";
import {
  type Lm1RankedRecord,
  compareLm1RankedRecords,
  lm1SelectionCandidates,
  lm1StateGroups,
  requiredLm1EvidenceIds,
} from "./lm1-selector-state.js";
import type { FileLm1Store } from "./lm1-store.js";
import { supportsLm1StateIndex } from "./lm1-store.js";

export const MAX_LM1_FUSED_CANDIDATES = 1_000;
export const MAX_LM1_FUSED_EVIDENCE_LOOKUPS = 512;

type Omitted = { id: string; reason: string; anchor: Lm1RankedRecord };
type Selected = { anchor: Lm1RankedRecord; record: Lm1Record };

function eligibleResult(workspaceKey: string, evidenceIds: readonly string[], value: unknown) {
  let parsed: ReturnType<typeof evidenceEligibilityResultSchema.safeParse>;
  try {
    parsed = evidenceEligibilityResultSchema.safeParse(value);
  } catch {
    throw new Lm1Error("store_corrupt", "Evidence eligibility response is unreadable.");
  }
  if (!parsed.success) {
    throw new Lm1Error("store_corrupt", "Evidence eligibility response is invalid.");
  }
  return (
    parsed.data.length === evidenceIds.length &&
    parsed.data.every(
      (entry, index) =>
        entry.evidenceId === evidenceIds[index] &&
        entry.workspaceKey === workspaceKey &&
        entry.status === "available" &&
        !entry.unresolvedHighRisk,
    )
  );
}

function structuralLookups(
  store: FileLm1Store,
  workspaceKey: string,
  records: readonly Lm1Record[],
  ranked: readonly Lm1RankedRecord[],
) {
  const snapshots = records.filter(
    (record): record is Lm1Snapshot => record.kind === "state_snapshot",
  );
  const stateStore = supportsLm1StateIndex(store) ? store : undefined;
  const stateKeys = ranked.flatMap(({ record }) =>
    record.kind === "state_snapshot" ? [record.stateKey] : [],
  );
  const state = stateStore?.stateSnapshotsForStateKeys(workspaceKey, stateKeys, 10_000) ?? {
    snapshotsByStateKey: new Map<string, readonly Lm1Snapshot[]>(),
    indexedStateKeys: new Set<string>(),
    incompleteStateKeys: new Set<string>(),
  };
  const closure = stateStore?.closureSuccessorIds(
    workspaceKey,
    [
      ...snapshots.map(({ id }) => id),
      ...[...state.snapshotsByStateKey.values()].flatMap((items) => items.map(({ id }) => id)),
    ],
    10_000,
  ) ?? {
    successorIdsBySnapshotId: new Map<string, readonly string[]>(),
    incompletePredecessorSnapshotIds: new Set<string>(),
  };
  return { snapshots, groups: lm1StateGroups(snapshots, state, closure) };
}

export async function selectLm1RankedRecords(input: {
  store: FileLm1Store;
  evidenceEligibility: EvidenceEligibilityPort;
  request: Lm1RecallRequest;
  records: readonly Lm1Record[];
  ranked: readonly Lm1RankedRecord[];
  scannedRecordCount: number;
}): Promise<Lm1RecallBundle> {
  const { groups } = structuralLookups(
    input.store,
    input.request.workspaceKey,
    input.records,
    input.ranked,
  );
  const recordsById = new Map(input.records.map((record) => [record.id, record]));
  const omitted: Omitted[] = [];
  const selectedCandidates: Selected[] = [];
  const resolvedEvidenceIds = new Set<string>();
  const eligibilityFor = async (record: Lm1Record) => {
    const evidenceIds = requiredLm1EvidenceIds(record, recordsById);
    if (evidenceIds.length === 0) return "unavailable" as const;
    const unseen = evidenceIds.filter((id) => !resolvedEvidenceIds.has(id));
    if (resolvedEvidenceIds.size + unseen.length > MAX_LM1_FUSED_EVIDENCE_LOOKUPS) {
      return "limit" as const;
    }
    let value: unknown;
    try {
      value = await input.evidenceEligibility.resolve({
        workspaceKey: input.request.workspaceKey,
        evidenceIds,
      });
    } catch {
      throw new Lm1Error("store_corrupt", "Evidence eligibility port failed.");
    }
    for (const id of unseen) resolvedEvidenceIds.add(id);
    return eligibleResult(input.request.workspaceKey, evidenceIds, value)
      ? ("eligible" as const)
      : ("unavailable" as const);
  };

  for (const candidate of lm1SelectionCandidates(input.ranked, groups)) {
    if (candidate.type === "transition") {
      const eligibility = await eligibilityFor(candidate.anchor.record);
      if (eligibility === "eligible") {
        selectedCandidates.push({ anchor: candidate.anchor, record: candidate.anchor.record });
      } else {
        omitted.push({
          id: candidate.anchor.record.id,
          reason:
            eligibility === "limit" ? "omitted_evidence_limit" : "omitted_evidence_unavailable",
          anchor: candidate.anchor,
        });
      }
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
    } else if (limited) {
      omitted.push({
        id: candidate.anchor.record.id,
        reason: "omitted_evidence_limit",
        anchor: candidate.anchor,
      });
    } else {
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
  }

  selectedCandidates.sort((left, right) => compareLm1RankedRecords(left.anchor, right.anchor));
  const items: { type: "text"; value: string; observationId: string }[] = [];
  const selected: { id: string; score: number; tokenCount: number }[] = [];
  let usedTokens = 0;
  for (const candidate of selectedCandidates) {
    const tokenCount = Math.ceil(candidate.record.text.length / 4);
    if (usedTokens + tokenCount > input.request.tokenBudget) {
      omitted.push({ id: candidate.record.id, reason: "omitted_budget", anchor: candidate.anchor });
      continue;
    }
    usedTokens += tokenCount;
    items.push({ type: "text", value: candidate.record.text, observationId: candidate.record.id });
    selected.push({ id: candidate.record.id, score: candidate.anchor.score, tokenCount });
  }
  omitted.sort((left, right) => compareLm1RankedRecords(left.anchor, right.anchor));
  return {
    items,
    receipt: {
      selected,
      omitted: omitted.map(({ id, reason }) => ({ id, reason })),
      scannedRecordCount: input.scannedRecordCount,
      candidateCount: input.ranked.length,
      evidenceLookupCount: resolvedEvidenceIds.size,
    },
  };
}

export type Lm1FusedSelector = {
  select(
    input: Lm1RecallRequest & { candidates: readonly { id: string; score: number }[] },
  ): Promise<Lm1RecallBundle>;
};

export function createLm1FusedSelector(input: {
  store: FileLm1Store;
  evidenceEligibility: EvidenceEligibilityPort;
}): Lm1FusedSelector {
  return {
    async select(request) {
      const { candidates, ...recallRequest } = request;
      const parsed = lm1RecallRequestSchema.safeParse(recallRequest);
      if (!parsed.success || candidates.length > MAX_LM1_FUSED_CANDIDATES) {
        throw new Lm1Error("invalid_input", "Invalid LM1 fused selection request.");
      }
      const ids = new Set<string>();
      const ranked: Lm1RankedRecord[] = [];
      const records: Lm1Record[] = [];
      for (const candidate of candidates) {
        if (ids.has(candidate.id) || !Number.isFinite(candidate.score) || candidate.score < 0) {
          throw new Lm1Error("invalid_input", "Invalid LM1 fused selection request.");
        }
        ids.add(candidate.id);
        const record = input.store.getById(parsed.data.workspaceKey, candidate.id);
        records.push(record);
        ranked.push({ score: candidate.score, record });
        if (record.kind === "state_transition") {
          for (const endpointId of [record.preSnapshotId, record.postSnapshotId]) {
            if (!records.some(({ id }) => id === endpointId)) {
              records.push(input.store.getById(parsed.data.workspaceKey, endpointId));
            }
          }
        }
      }
      return selectLm1RankedRecords({
        ...input,
        request: parsed.data,
        records,
        ranked,
        scannedRecordCount: candidates.length,
      });
    },
  };
}
