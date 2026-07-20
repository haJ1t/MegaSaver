import { rankBm25 } from "@megasaver/retrieval";
import { Lm1Error } from "./lm1-errors.js";
import { selectLm1RankedRecords } from "./lm1-fused-selector.js";
import type {
  EvidenceEligibilityPort,
  Lm1RecallBundle,
  Lm1RecallRequest,
  Lm1Record,
} from "./lm1-model.js";
import { MAX_LM1_RECALL_TOKEN_BUDGET, lm1RecallRequestSchema } from "./lm1-model.js";
import { compareLm1RankedRecords } from "./lm1-selector-state.js";
import type { FileLm1Store } from "./lm1-store.js";

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
  if (!parsed.success) throw new Lm1Error("invalid_input", "Invalid LM1 recall request.");
  return parsed.data;
}

function compareRecords(left: Lm1Record, right: Lm1Record): number {
  return right.observedAt.localeCompare(left.observedAt) || left.id.localeCompare(right.id);
}

export function createLm1RecallService(input: {
  store: FileLm1Store;
  evidenceEligibility: EvidenceEligibilityPort;
}): Lm1RecallService {
  return {
    async recall(request) {
      const parsedRequest = parseRecallRequest(request);
      const records = input.store.list(parsedRequest.workspaceKey, MAX_LM1_RECORDS_SCANNED);
      const candidates = [...records].sort(compareRecords);
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
        .sort(compareLm1RankedRecords);
      return selectLm1RankedRecords({
        ...input,
        request: parsedRequest,
        records,
        ranked,
        scannedRecordCount: records.length,
      });
    },
  };
}
