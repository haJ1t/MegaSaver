import { rankBm25 } from "@megasaver/retrieval";
import { Lm2Error } from "./lm2-errors.js";
import { canonicalFloat32, modelDescriptorFingerprint } from "./lm2-identity.js";
import {
  type EmbeddingPort,
  type HybridReceipt,
  type HybridSemanticReason,
  type Lm2Candidate,
  type Lm2RankRequest,
  type RemoteEmbeddingApprovalPort,
  lm2CandidateSchema,
  lm2RankRequestSchema,
} from "./lm2-model.js";
import {
  type Lm2VectorStore,
  type Lm2VerifiedVector,
  MAX_LM2_DECODED_QUERY_VECTOR_BYTES,
} from "./lm2-vector-store.js";

const MAX_CANDIDATES = 10_000;
const MAX_CORPUS_UTF8_BYTES = 64 * 1024 * 1024;
const MAX_LANE_HITS = 1_000;
const MAX_SEMANTIC_INPUT_CODE_UNITS = 8_192;
const RRF_CONSTANT = 60;

export type Lm2RankClock = { now(): number };

export type Lm2RankResult = {
  orderedCandidateIds: readonly string[];
  scores: readonly { id: string; score: number }[];
  hybrid: HybridReceipt;
};

export type RankLm2CandidatesInput = {
  candidates: readonly Lm2Candidate[];
  request: Lm2RankRequest;
  vectors: Pick<Lm2VectorStore, "readVerified">;
  embedding: EmbeddingPort;
  clock: Lm2RankClock;
  remoteApproval?: RemoteEmbeddingApprovalPort;
  approvalRef?: string;
  adaptiveCandidateScope?: "lm2_capture_window" | "benchmark_run_cache";
  candidateInputOmittedCount?: number;
};

type LaneHit = { candidate: Lm2Candidate; score: number };
type FusedHit = { candidate: Lm2Candidate; score: number };

function parseCandidates(
  candidates: readonly Lm2Candidate[],
  workspaceKey: string,
): Lm2Candidate[] {
  if (candidates.length > MAX_CANDIDATES) {
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
    if (corpusBytes > MAX_CORPUS_UTF8_BYTES) {
      throw new Lm2Error("candidate_store_invalid", "LM2 candidate corpus exceeds its limit.");
    }
    ids.add(result.data.id);
    parsed.push(result.data);
  }
  return parsed;
}

function compareLaneHit(left: LaneHit, right: LaneHit): number {
  return (
    right.score - left.score ||
    right.candidate.observedAt.localeCompare(left.candidate.observedAt) ||
    left.candidate.id.localeCompare(right.candidate.id)
  );
}

function lexicalLane(candidates: readonly Lm2Candidate[], task: string): readonly LaneHit[] {
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
    .slice(0, MAX_LANE_HITS);
}

function normalizedVector(values: readonly number[], dimensions: number): readonly number[] | null {
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

function semanticLane(
  candidates: ReadonlyMap<string, Lm2Candidate>,
  verified: readonly Lm2VerifiedVector[],
  queryVector: readonly number[],
  dimensions: number,
): { hits: readonly LaneHit[]; validVectorIds: ReadonlySet<string>; invalidCount: number } {
  const query = normalizedVector(queryVector, dimensions);
  if (query === null) return { hits: [], validVectorIds: new Set(), invalidCount: verified.length };
  const hits: LaneHit[] = [];
  const validVectorIds = new Set<string>();
  let invalidCount = 0;
  for (const item of verified) {
    const candidate = candidates.get(item.candidateId);
    const document = normalizedVector(item.vector, dimensions);
    if (
      candidate === undefined ||
      validVectorIds.has(item.candidateId) ||
      !Number.isInteger(item.decodedBytes) ||
      item.decodedBytes < 0 ||
      document === null
    ) {
      invalidCount += 1;
      continue;
    }
    validVectorIds.add(item.candidateId);
    let score = 0;
    for (let index = 0; index < dimensions; index += 1) {
      score += (query[index] as number) * (document[index] as number);
    }
    if (score > 0 && Number.isFinite(score)) hits.push({ candidate, score });
  }
  return {
    hits: hits.sort(compareLaneHit).slice(0, MAX_LANE_HITS),
    validVectorIds,
    invalidCount,
  };
}

function fuseLanes(
  candidatesById: ReadonlyMap<string, Lm2Candidate>,
  lanes: readonly (readonly LaneHit[])[],
): readonly FusedHit[] {
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
    .slice(0, MAX_LANE_HITS);
}

function elapsed(clock: Lm2RankClock, startedAt: number): number {
  let endedAt: number;
  try {
    endedAt = clock.now();
  } catch {
    return 0;
  }
  return Number.isFinite(endedAt) && endedAt >= startedAt ? endedAt - startedAt : 0;
}

function sortedReasons(reasons: Iterable<HybridSemanticReason>): HybridSemanticReason[] {
  return [...new Set(reasons)].sort();
}

function baseReceipt(input: {
  request: Lm2RankRequest;
  candidates: readonly Lm2Candidate[];
  omitted: number;
  lexicalCount: number;
  fusedCount: number;
  startedAt: number;
  clock: Lm2RankClock;
}): HybridReceipt {
  return {
    profile: input.request.profile,
    adaptiveCandidateScope:
      input.request.profile === "safe" ? "not_applicable" : "benchmark_run_cache",
    adaptiveCatalogRecordCount: input.candidates.length,
    candidateInputOmittedCount: input.omitted,
    lexicalCandidateCount: input.lexicalCount,
    semanticCandidateCount: 0,
    fusedCandidateCount: input.fusedCount,
    semanticStatus: input.request.profile === "safe" ? "not_requested" : "degraded",
    semanticReasons: input.request.profile === "safe" ? [] : ["missing_vectors"],
    indexedVectorCount: 0,
    missingVectorCount: input.candidates.length,
    invalidVectorCount: 0,
    semanticVectorBytesRead: 0,
    queryLatencyMs: elapsed(input.clock, input.startedAt),
  };
}

type SemanticOutcome =
  | { type: "complete"; verified: readonly Lm2VerifiedVector[]; queryVector: readonly number[] }
  | { type: "degraded"; reason: HybridSemanticReason };

async function runSemantic(input: {
  request: Lm2RankRequest & { model: NonNullable<Lm2RankRequest["model"]> };
  candidates: readonly Lm2Candidate[];
  vectors: Pick<Lm2VectorStore, "readVerified">;
  embedding: EmbeddingPort;
  remoteApproval?: RemoteEmbeddingApprovalPort;
  approvalRef?: string;
  controller: AbortController;
}): Promise<SemanticOutcome> {
  let verified: readonly Lm2VerifiedVector[];
  try {
    verified = await input.vectors.readVerified({
      workspaceKey: input.request.workspaceKey,
      model: input.request.model,
      candidates: input.candidates,
      maxDecodedBytes: MAX_LM2_DECODED_QUERY_VECTOR_BYTES,
      signal: input.controller.signal,
    });
  } catch {
    return { type: "degraded", reason: "vector_read_limit" };
  }
  if (input.controller.signal.aborted) return { type: "degraded", reason: "timeout" };
  if (verified.length === 0) return { type: "degraded", reason: "missing_vectors" };

  const fingerprint = modelDescriptorFingerprint(input.request.model);
  if (input.embedding.egress === "remote") {
    if (input.remoteApproval === undefined || input.approvalRef === undefined) {
      return { type: "degraded", reason: "remote_approval_denied" };
    }
    let approval: Awaited<ReturnType<RemoteEmbeddingApprovalPort["assertCurrent"]>>;
    try {
      approval = await input.remoteApproval.assertCurrent({
        workspaceKey: input.request.workspaceKey,
        modelFingerprint: fingerprint,
        purpose: "query",
        approvalRef: input.approvalRef,
      });
    } catch {
      return { type: "degraded", reason: "remote_approval_denied" };
    }
    if (approval !== "approved") return { type: "degraded", reason: "remote_approval_denied" };
  }
  if (input.controller.signal.aborted) return { type: "degraded", reason: "timeout" };
  let output: unknown;
  try {
    output = await input.embedding.embed({
      model: input.request.model,
      purpose: "query",
      texts: [input.request.task],
      signal: input.controller.signal,
    });
  } catch {
    return {
      type: "degraded",
      reason: input.controller.signal.aborted ? "timeout" : "port_failure",
    };
  }
  if (input.controller.signal.aborted) return { type: "degraded", reason: "timeout" };
  if (typeof output !== "object" || output === null) {
    return { type: "degraded", reason: "invalid_vectors" };
  }
  let modelFingerprint: unknown;
  let vectors: unknown;
  try {
    const candidate = output as { modelFingerprint?: unknown; vectors?: unknown };
    modelFingerprint = candidate.modelFingerprint;
    vectors = candidate.vectors;
  } catch {
    return { type: "degraded", reason: "invalid_vectors" };
  }
  if (
    modelFingerprint !== fingerprint ||
    !Array.isArray(vectors) ||
    vectors.length !== 1 ||
    !Array.isArray(vectors[0])
  ) {
    return { type: "degraded", reason: "invalid_vectors" };
  }
  return { type: "complete", verified, queryVector: vectors[0] as readonly number[] };
}

export async function rankLm2Candidates(input: RankLm2CandidatesInput): Promise<Lm2RankResult> {
  const parsedRequest = lm2RankRequestSchema.safeParse(input.request);
  if (!parsedRequest.success) throw new Lm2Error("invalid_input", "Invalid LM2 rank request.");
  const omitted = input.candidateInputOmittedCount ?? 0;
  if (!Number.isInteger(omitted) || omitted < 0) {
    throw new Lm2Error("invalid_input", "Invalid LM2 candidate omission count.");
  }
  let startedAt = 0;
  try {
    startedAt = input.clock.now();
  } catch {
    throw new Lm2Error("invalid_input", "Invalid LM2 rank clock.");
  }
  if (!Number.isFinite(startedAt)) throw new Lm2Error("invalid_input", "Invalid LM2 rank clock.");
  const candidates = parseCandidates(input.candidates, parsedRequest.data.workspaceKey);
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const lexical = lexicalLane(candidates, parsedRequest.data.task);
  const lexicalOnly = fuseLanes(candidatesById, [lexical]);

  if (parsedRequest.data.profile === "safe") {
    const hybrid = baseReceipt({
      request: parsedRequest.data,
      candidates,
      omitted,
      lexicalCount: lexical.length,
      fusedCount: lexicalOnly.length,
      startedAt,
      clock: input.clock,
    });
    return {
      orderedCandidateIds: lexicalOnly.map((hit) => hit.candidate.id),
      scores: lexicalOnly.map((hit) => ({ id: hit.candidate.id, score: hit.score })),
      hybrid,
    };
  }

  const scope = input.adaptiveCandidateScope ?? "benchmark_run_cache";
  const degraded = (reason: HybridSemanticReason): Lm2RankResult => {
    const hybrid = baseReceipt({
      request: parsedRequest.data,
      candidates,
      omitted,
      lexicalCount: lexical.length,
      fusedCount: lexicalOnly.length,
      startedAt,
      clock: input.clock,
    });
    hybrid.adaptiveCandidateScope = scope;
    hybrid.semanticReasons = [reason];
    return {
      orderedCandidateIds: lexicalOnly.map((hit) => hit.candidate.id),
      scores: lexicalOnly.map((hit) => ({ id: hit.candidate.id, score: hit.score })),
      hybrid,
    };
  };
  if (parsedRequest.data.task.length > MAX_SEMANTIC_INPUT_CODE_UNITS)
    return degraded("input_limit");
  if (parsedRequest.data.model === undefined) return degraded("missing_vectors");

  const controller = new AbortController();
  const timeoutMs = parsedRequest.data.timeoutMs ?? 1_500;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SemanticOutcome>((resolve) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      resolve({ type: "degraded", reason: "timeout" });
    }, timeoutMs);
  });
  const operation = runSemantic({
    request: { ...parsedRequest.data, model: parsedRequest.data.model },
    candidates,
    vectors: input.vectors,
    embedding: input.embedding,
    ...(input.remoteApproval === undefined ? {} : { remoteApproval: input.remoteApproval }),
    ...(input.approvalRef === undefined ? {} : { approvalRef: input.approvalRef }),
    controller,
  });
  const semantic = await Promise.race([operation, timeout]);
  if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  if (semantic.type === "degraded") {
    operation.catch(() => undefined);
    return degraded(semantic.reason);
  }

  const lane = semanticLane(
    candidatesById,
    semantic.verified,
    semantic.queryVector,
    parsedRequest.data.model.dimensions,
  );
  if (lane.validVectorIds.size === 0) return degraded("invalid_vectors");
  const fused = fuseLanes(candidatesById, [lexical, lane.hits]);
  const missingCount = Math.max(0, candidates.length - lane.validVectorIds.size);
  const reasons = sortedReasons([
    ...(missingCount > 0 ? (["missing_vectors"] as const) : []),
    ...(lane.invalidCount > 0 ? (["invalid_vectors"] as const) : []),
  ]);
  const partial = reasons.length > 0;
  const hybrid: HybridReceipt = {
    profile: "adaptive",
    adaptiveCandidateScope: scope,
    adaptiveCatalogRecordCount: candidates.length,
    candidateInputOmittedCount: omitted,
    lexicalCandidateCount: lexical.length,
    semanticCandidateCount: lane.hits.length,
    fusedCandidateCount: fused.length,
    semanticStatus: partial ? "used_partial_index" : "used",
    semanticReasons: reasons,
    indexedVectorCount: lane.validVectorIds.size,
    missingVectorCount: missingCount,
    invalidVectorCount: lane.invalidCount,
    semanticVectorBytesRead: semantic.verified.reduce(
      (total, vector) =>
        total +
        (Number.isInteger(vector.decodedBytes) && vector.decodedBytes > 0
          ? vector.decodedBytes
          : 0),
      0,
    ),
    queryLatencyMs: elapsed(input.clock, startedAt),
  };
  return {
    orderedCandidateIds: fused.map((hit) => hit.candidate.id),
    scores: fused.map((hit) => ({ id: hit.candidate.id, score: hit.score })),
    hybrid,
  };
}
