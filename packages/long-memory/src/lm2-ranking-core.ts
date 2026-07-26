import { rankBm25 } from "@megasaver/retrieval";
import { Lm2Error } from "./lm2-errors.js";
import { canonicalFloat32 } from "./lm2-identity.js";
import {
  type Lm2Candidate,
  MAX_LM2_CANDIDATE_CORPUS_UTF8_BYTES,
  MAX_LM2_RANK_CANDIDATES,
  lm2CandidateSchema,
} from "./lm2-model.js";

export const MAX_LM2_LANE_HITS = 1_000;
const RRF_CONSTANT = 60;

export type Lm2LaneHit = { candidate: Lm2Candidate; score: number };
export type Lm2FusedHit = { candidate: Lm2Candidate; score: number };
export type Lm2ScoredVector = {
  candidateId: string;
  vector: readonly number[];
  decodedBytes: number;
};

export function parseRankCandidates(
  candidates: readonly Lm2Candidate[],
  workspaceKey: string,
): Lm2Candidate[] {
  if (candidates.length > MAX_LM2_RANK_CANDIDATES) {
    throw new Lm2Error("candidate_store_invalid", "LM2 candidate response exceeds its limit.");
  }
  const parsed: Lm2Candidate[] = [];
  const ids = new Set<string>();
  let corpusBytes = 0;
  for (const candidate of candidates) {
    const result = lm2CandidateSchema.safeParse(candidate);
    if (!result.success || result.data.workspaceKey !== workspaceKey || ids.has(result.data.id)) {
      throw new Lm2Error("candidate_store_invalid", "LM2 candidate response is invalid.");
    }
    corpusBytes += Buffer.byteLength(result.data.text, "utf8");
    if (!Number.isSafeInteger(corpusBytes) || corpusBytes > MAX_LM2_CANDIDATE_CORPUS_UTF8_BYTES) {
      throw new Lm2Error("candidate_store_invalid", "LM2 candidate corpus exceeds its limit.");
    }
    ids.add(result.data.id);
    parsed.push(result.data);
  }
  return parsed;
}

function compareLaneHit(left: Lm2LaneHit, right: Lm2LaneHit): number {
  return (
    right.score - left.score ||
    right.candidate.observedAt.localeCompare(left.candidate.observedAt) ||
    left.candidate.id.localeCompare(right.candidate.id)
  );
}

export function rankLexicalLane(
  candidates: readonly Lm2Candidate[],
  task: string,
): readonly Lm2LaneHit[] {
  if (candidates.length === 0) return [];
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return rankBm25({
    query: task,
    documents: candidates.map(({ id, text }) => ({ id, text })),
    topN: candidates.length,
  })
    .flatMap((hit) => {
      const candidate = byId.get(hit.id);
      return candidate !== undefined && hit.score > 0 && Number.isFinite(hit.score)
        ? [{ candidate, score: hit.score }]
        : [];
    })
    .sort(compareLaneHit)
    .slice(0, MAX_LM2_LANE_HITS);
}

export function normalizeLm2Vector(
  values: readonly number[],
  dimensions: number,
): readonly number[] | null {
  if (values.length !== dimensions) return null;
  let canonical: Float32Array;
  try {
    canonical = canonicalFloat32(values);
  } catch {
    return null;
  }
  let maximum = 0;
  for (const value of canonical) maximum = Math.max(maximum, Math.abs(value));
  if (!(maximum > 0) || !Number.isFinite(maximum)) return null;
  let scaledSquareSum = 0;
  for (const value of canonical) {
    const scaled = value / maximum;
    scaledSquareSum += scaled * scaled;
  }
  const norm = Math.sqrt(scaledSquareSum);
  if (!(norm > 0) || !Number.isFinite(norm)) return null;
  return Array.from(canonical, (value) => value / maximum / norm);
}

export function rankSemanticLane(input: {
  candidates: ReadonlyMap<string, Lm2Candidate>;
  vectors: readonly Lm2ScoredVector[];
  queryVector: readonly number[];
  dimensions: number;
}): readonly Lm2LaneHit[] {
  const query = normalizeLm2Vector(input.queryVector, input.dimensions);
  if (query === null) return [];
  const hits: Lm2LaneHit[] = [];
  for (const item of input.vectors) {
    const candidate = input.candidates.get(item.candidateId);
    const document = normalizeLm2Vector(item.vector, input.dimensions);
    if (candidate === undefined || document === null) continue;
    let score = 0;
    const documentValues = document[Symbol.iterator]();
    for (const queryValue of query) {
      const next = documentValues.next();
      if (next.done) throw new Lm2Error("invalid_vectors", "Invalid semantic vector tuple.");
      score += queryValue * next.value;
    }
    if (score > 0 && Number.isFinite(score)) hits.push({ candidate, score });
  }
  return hits.sort(compareLaneHit).slice(0, MAX_LM2_LANE_HITS);
}

export function fuseLm2Lanes(
  candidatesById: ReadonlyMap<string, Lm2Candidate>,
  lanes: readonly (readonly Lm2LaneHit[])[],
): readonly Lm2FusedHit[] {
  const scores = new Map<string, number>();
  for (const lane of lanes) {
    lane.forEach((hit, index) => {
      scores.set(
        hit.candidate.id,
        (scores.get(hit.candidate.id) ?? 0) + 1 / (RRF_CONSTANT + index + 1),
      );
    });
  }
  return [...scores]
    .flatMap(([id, score]) => {
      const candidate = candidatesById.get(id);
      return candidate === undefined ? [] : [{ candidate, score }];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.candidate.observedAt.localeCompare(left.candidate.observedAt) ||
        left.candidate.id.localeCompare(right.candidate.id),
    )
    .slice(0, MAX_LM2_LANE_HITS);
}
