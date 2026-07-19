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
import type { FileLm1Store } from "./lm1-store.js";

export const MAX_LM1_RECORDS_SCANNED = 10_000;
export const MAX_LM1_CANDIDATES = 1_000;
export const MAX_LM1_EVIDENCE_LOOKUPS = 512;
export const MAX_LM1_TOKEN_BUDGET = MAX_LM1_RECALL_TOKEN_BUDGET;

export type Lm1RecallService = {
  recall(request: Lm1RecallRequest): Promise<Lm1RecallBundle>;
};

function parseRecallRequest(request: Lm1RecallRequest): Lm1RecallRequest {
  const parsed = lm1RecallRequestSchema.safeParse(request);
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
  const parsed = evidenceEligibilityResultSchema.safeParse(result);
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
  if (error instanceof Lm1Error) throw error;
  throw new Lm1Error("store_corrupt", "Evidence eligibility port failed.");
}

type RankedRecord = { score: number; record: Lm1Record };
type RankedSnapshot = { score: number; record: Lm1Snapshot };

function currentEligibleSnapshot(candidates: readonly RankedSnapshot[]): RankedSnapshot | null {
  let winner: RankedSnapshot | undefined;
  for (const candidate of candidates) {
    if (winner === undefined || compareSnapshotsForCurrent(candidate.record, winner.record) < 0) {
      winner = candidate;
    }
  }
  return winner ?? null;
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
      const structuralLeaves = selectStructuralSnapshotLeaves(snapshots);
      const transitions = records.filter((record) => record.kind === "state_transition");
      const candidates = [...structuralLeaves, ...transitions].sort(compareSecondaryRecords);
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

      const items: { type: "text"; value: string; observationId: string }[] = [];
      const selected: { id: string; score: number; tokenCount: number }[] = [];
      const omitted: { id: string; reason: string }[] = [];
      const eligibleTransitions: RankedRecord[] = [];
      const eligibleSnapshotsByStateKey = new Map<string, RankedSnapshot[]>();
      const resolvedEvidenceIds = new Set<string>();

      for (const candidate of ranked) {
        const evidenceIds = requiredEvidenceIds(candidate.record, recordsById);
        if (evidenceIds.length === 0) {
          omitted.push({ id: candidate.record.id, reason: "omitted_evidence_unavailable" });
          continue;
        }
        const newEvidenceIds = evidenceIds.filter(
          (evidenceId) => !resolvedEvidenceIds.has(evidenceId),
        );
        if (resolvedEvidenceIds.size + newEvidenceIds.length > MAX_LM1_EVIDENCE_LOOKUPS) {
          omitted.push({ id: candidate.record.id, reason: "omitted_evidence_limit" });
          continue;
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
        if (!assertEligible(parsedRequest.workspaceKey, evidenceIds, eligibility)) {
          omitted.push({
            id: candidate.record.id,
            reason:
              candidate.record.kind === "state_snapshot" &&
              candidate.record.supersedesSnapshotId !== null
                ? "omitted_correction_chain_unavailable"
                : "omitted_evidence_unavailable",
          });
          continue;
        }
        if (candidate.record.kind === "state_snapshot") {
          const eligible = eligibleSnapshotsByStateKey.get(candidate.record.stateKey) ?? [];
          eligible.push({ score: candidate.score, record: candidate.record });
          eligibleSnapshotsByStateKey.set(candidate.record.stateKey, eligible);
          continue;
        }
        eligibleTransitions.push(candidate);
      }

      const selectedCandidates = [
        ...eligibleTransitions,
        ...[...eligibleSnapshotsByStateKey.values()].flatMap((candidatesForStateKey) => {
          const winner = currentEligibleSnapshot(candidatesForStateKey);
          return winner === null ? [] : [winner];
        }),
      ].sort(compareRankedRecords);
      let usedTokens = 0;

      for (const candidate of selectedCandidates) {
        const tokenCount = Math.ceil(candidate.record.text.length / 4);
        if (usedTokens + tokenCount > parsedRequest.tokenBudget) {
          omitted.push({ id: candidate.record.id, reason: "omitted_budget" });
          continue;
        }
        usedTokens += tokenCount;
        items.push({
          type: "text",
          value: candidate.record.text,
          observationId: candidate.record.id,
        });
        selected.push({ id: candidate.record.id, score: candidate.score, tokenCount });
      }

      const rankById = new Map(ranked.map((candidate, index) => [candidate.record.id, index]));
      omitted.sort((left, right) => (rankById.get(left.id) ?? 0) - (rankById.get(right.id) ?? 0));

      return {
        items,
        receipt: {
          selected,
          omitted,
          scannedRecordCount: records.length,
          candidateCount: ranked.length,
          evidenceLookupCount: resolvedEvidenceIds.size,
        },
      };
    },
  };
}
