import { Lm2Error } from "./lm2-errors.js";
import {
  type EmbeddingPort,
  type HybridReceipt,
  type HybridSemanticReason,
  type Lm2Candidate,
  type Lm2RankRequest,
  type RemoteEmbeddingApprovalPort,
  hybridReceiptSchema,
  lm2RankRequestSchema,
} from "./lm2-model.js";
import {
  fuseLm2Lanes,
  parseRankCandidates,
  rankLexicalLane,
  rankSemanticLane,
} from "./lm2-ranking-core.js";
import {
  type Lm2RankVectorReader,
  type Lm2SemanticClock,
  type Lm2SemanticCoverage,
  runLm2SemanticLane,
} from "./lm2-semantic-lane.js";

const MAX_SEMANTIC_INPUT_CODE_UNITS = 8_192;

export type Lm2RankClock = Lm2SemanticClock;
export type Lm2RankResult = {
  orderedCandidateIds: readonly string[];
  scores: readonly { id: string; score: number }[];
  hybrid: HybridReceipt;
};

export type RankLm2CandidatesInput = {
  candidates: readonly Lm2Candidate[];
  request: Lm2RankRequest;
  vectors: Lm2RankVectorReader;
  embedding: EmbeddingPort;
  clock: Lm2RankClock;
  remoteApproval?: RemoteEmbeddingApprovalPort;
  approvalRef?: string;
  adaptiveCandidateScope?: "lm2_capture_window" | "benchmark_run_cache";
  candidateInputOmittedCount?: number;
};

function elapsed(clock: Lm2RankClock, startedAt: number): number {
  try {
    const endedAt = clock.now();
    return Number.isFinite(endedAt) && endedAt >= startedAt ? endedAt - startedAt : 0;
  } catch {
    return 0;
  }
}

function receipt(input: {
  request: Lm2RankRequest;
  scope: "not_applicable" | "lm2_capture_window" | "benchmark_run_cache";
  candidateCount: number;
  omitted: number;
  lexicalCount: number;
  semanticCount: number;
  fusedCount: number;
  semanticStatus: HybridReceipt["semanticStatus"];
  semanticReasons: readonly HybridSemanticReason[];
  coverage: Lm2SemanticCoverage;
  startedAt: number;
  clock: Lm2RankClock;
}): HybridReceipt {
  return hybridReceiptSchema.parse({
    profile: input.request.profile,
    adaptiveCandidateScope: input.scope,
    adaptiveCatalogRecordCount: input.candidateCount,
    candidateInputOmittedCount: input.omitted,
    lexicalCandidateCount: input.lexicalCount,
    semanticCandidateCount: input.semanticCount,
    fusedCandidateCount: input.fusedCount,
    semanticStatus: input.semanticStatus,
    semanticReasons: input.semanticReasons,
    indexedVectorCount: input.coverage.vectors.length,
    missingVectorCount: input.coverage.missingVectorCount,
    invalidVectorCount: input.coverage.invalidVectorCount,
    semanticVectorBytesRead: input.coverage.semanticVectorBytesRead,
    queryLatencyMs: elapsed(input.clock, input.startedAt),
  });
}

const noCoverage: Lm2SemanticCoverage = {
  vectors: [],
  reasons: [],
  missingVectorCount: 0,
  invalidVectorCount: 0,
  semanticVectorBytesRead: 0,
};

function resultFromHits(input: {
  hits: readonly { candidate: Lm2Candidate; score: number }[];
  hybrid: HybridReceipt;
}): Lm2RankResult {
  return {
    orderedCandidateIds: input.hits.map((hit) => hit.candidate.id),
    scores: input.hits.map((hit) => ({ id: hit.candidate.id, score: hit.score })),
    hybrid: input.hybrid,
  };
}

export async function rankLm2Candidates(input: RankLm2CandidatesInput): Promise<Lm2RankResult> {
  const parsedRequest = lm2RankRequestSchema.safeParse(input.request);
  if (!parsedRequest.success) throw new Lm2Error("invalid_input", "Invalid LM2 rank request.");
  const omitted = input.candidateInputOmittedCount ?? 0;
  if (!Number.isSafeInteger(omitted) || omitted < 0) {
    throw new Lm2Error("invalid_input", "Invalid LM2 candidate omission count.");
  }
  const scope = input.adaptiveCandidateScope ?? "benchmark_run_cache";
  if (scope !== "lm2_capture_window" && scope !== "benchmark_run_cache") {
    throw new Lm2Error("invalid_input", "Invalid LM2 candidate scope.");
  }
  let startedAt: number;
  try {
    startedAt = input.clock.now();
  } catch {
    throw new Lm2Error("invalid_input", "Invalid LM2 rank clock.");
  }
  if (!Number.isFinite(startedAt)) throw new Lm2Error("invalid_input", "Invalid LM2 rank clock.");

  const request = parsedRequest.data;
  const candidates = parseRankCandidates(input.candidates, request.workspaceKey);
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const lexical = rankLexicalLane(candidates, request.task);
  const lexicalOnly = fuseLm2Lanes(candidatesById, [lexical]);

  const degraded = (
    reasons: readonly HybridSemanticReason[],
    coverage: Lm2SemanticCoverage,
  ): Lm2RankResult =>
    resultFromHits({
      hits: lexicalOnly,
      hybrid: receipt({
        request,
        scope,
        candidateCount: candidates.length,
        omitted,
        lexicalCount: lexical.length,
        semanticCount: 0,
        fusedCount: lexicalOnly.length,
        semanticStatus: "degraded",
        semanticReasons: [...new Set(reasons)].sort(),
        coverage,
        startedAt,
        clock: input.clock,
      }),
    });

  if (request.profile === "safe") {
    return resultFromHits({
      hits: lexicalOnly,
      hybrid: receipt({
        request,
        scope: "not_applicable",
        candidateCount: candidates.length,
        omitted,
        lexicalCount: lexical.length,
        semanticCount: 0,
        fusedCount: lexicalOnly.length,
        semanticStatus: "not_requested",
        semanticReasons: [],
        coverage: noCoverage,
        startedAt,
        clock: input.clock,
      }),
    });
  }
  if (request.task.length > MAX_SEMANTIC_INPUT_CODE_UNITS) {
    return degraded(["input_limit"], noCoverage);
  }
  if (request.model === undefined) {
    return degraded(["missing_vectors"], { ...noCoverage, missingVectorCount: candidates.length });
  }

  const semantic = await runLm2SemanticLane({
    request: { ...request, model: request.model },
    candidates,
    vectors: input.vectors,
    embedding: input.embedding,
    clock: input.clock,
    startedAtMs: startedAt,
    timeoutMs: request.timeoutMs ?? 1_500,
    ...(input.remoteApproval === undefined ? {} : { remoteApproval: input.remoteApproval }),
    ...(input.approvalRef === undefined ? {} : { approvalRef: input.approvalRef }),
  });
  if (semantic.status === "degraded") return degraded(semantic.reasons, semantic.coverage);

  const semanticHits = rankSemanticLane({
    candidates: candidatesById,
    vectors: semantic.coverage.vectors,
    queryVector: semantic.queryVector,
    dimensions: request.model.dimensions,
  });
  const fused = fuseLm2Lanes(candidatesById, [lexical, semanticHits]);
  const partial = semantic.coverage.reasons.length > 0;
  return resultFromHits({
    hits: fused,
    hybrid: receipt({
      request,
      scope,
      candidateCount: candidates.length,
      omitted,
      lexicalCount: lexical.length,
      semanticCount: semanticHits.length,
      fusedCount: fused.length,
      semanticStatus: partial ? "used_partial_index" : "used",
      semanticReasons: semantic.coverage.reasons,
      coverage: semantic.coverage,
      startedAt,
      clock: input.clock,
    }),
  });
}
