import { z } from "zod";
import { modelDescriptorFingerprint } from "./lm2-identity.js";
import {
  type EmbeddingPort,
  type HybridSemanticReason,
  type Lm2Candidate,
  type Lm2RankRequest,
  type RemoteEmbeddingApprovalPort,
  lm2VectorReadResultSchema,
} from "./lm2-model.js";
import { type Lm2ScoredVector, normalizeLm2Vector } from "./lm2-ranking-core.js";
import type { Lm2VectorStore } from "./lm2-vector-store.js";

const MAX_DECODED_VECTOR_BYTES = 64 * 1024 * 1024;

export type Lm2SemanticClock = { now(): number };
export type Lm2RankVectorReader = Pick<Lm2VectorStore, "read">;

export type Lm2SemanticCoverage = {
  vectors: readonly Lm2ScoredVector[];
  reasons: readonly HybridSemanticReason[];
  missingVectorCount: number;
  invalidVectorCount: number;
  semanticVectorBytesRead: number;
};

export type Lm2SemanticOutcome =
  | { status: "ready"; coverage: Lm2SemanticCoverage; queryVector: readonly number[] }
  | { status: "degraded"; coverage: Lm2SemanticCoverage; reasons: readonly HybridSemanticReason[] };

const embeddingOutputSchema = z
  .object({
    modelFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    vectors: z.array(z.array(z.number().finite()).min(1).max(4_096)).max(1),
  })
  .strict();

function sortedReasons(reasons: Iterable<HybridSemanticReason>): HybridSemanticReason[] {
  return [...new Set(reasons)].sort();
}

function emptyCoverage(): Lm2SemanticCoverage {
  return {
    vectors: [],
    reasons: [],
    missingVectorCount: 0,
    invalidVectorCount: 0,
    semanticVectorBytesRead: 0,
  };
}

function invalidCoverage(): Lm2SemanticCoverage {
  return { ...emptyCoverage(), reasons: ["invalid_vectors"], invalidVectorCount: 1 };
}

type ParsedVectorRead =
  | { status: "valid"; coverage: Lm2SemanticCoverage }
  | { status: "invalid"; reason: "invalid_vectors" | "vector_read_limit" };

function parseVectorRead(input: {
  value: unknown;
  candidates: readonly Lm2Candidate[];
  dimensions: number;
}): ParsedVectorRead {
  const parsed = lm2VectorReadResultSchema.safeParse(input.value);
  if (!parsed.success) return { status: "invalid", reason: "invalid_vectors" };
  const candidateIds = new Set(input.candidates.map(({ id }) => id));
  const vectorIds = new Set<string>();
  let decodedBytes = 0;
  for (const item of parsed.data.vectors) {
    if (
      !candidateIds.has(item.candidateId) ||
      vectorIds.has(item.candidateId) ||
      item.vector.length !== input.dimensions ||
      item.decodedBytes !== input.dimensions * 4 ||
      normalizeLm2Vector(item.vector, input.dimensions) === null
    ) {
      return { status: "invalid", reason: "invalid_vectors" };
    }
    decodedBytes += item.decodedBytes;
    if (!Number.isSafeInteger(decodedBytes) || decodedBytes > MAX_DECODED_VECTOR_BYTES) {
      return { status: "invalid", reason: "vector_read_limit" };
    }
    vectorIds.add(item.candidateId);
  }

  const classifiedIds = new Set<string>();
  const missingIds = new Set<string>();
  const invalidIds = new Set<string>();
  const reasons = new Set<HybridSemanticReason>();
  for (const diagnostic of parsed.data.diagnostics) {
    if (!candidateIds.has(diagnostic.candidateId)) {
      return { status: "invalid", reason: "invalid_vectors" };
    }
    if (vectorIds.has(diagnostic.candidateId) && diagnostic.reason !== "quota_recovery_pending") {
      return { status: "invalid", reason: "invalid_vectors" };
    }
    classifiedIds.add(diagnostic.candidateId);
    reasons.add(diagnostic.reason);
    if (diagnostic.reason === "missing_vectors") missingIds.add(diagnostic.candidateId);
    if (diagnostic.reason === "invalid_vectors") invalidIds.add(diagnostic.candidateId);
  }
  for (const candidate of input.candidates) {
    if (!vectorIds.has(candidate.id) && !classifiedIds.has(candidate.id)) {
      missingIds.add(candidate.id);
      reasons.add("missing_vectors");
    }
  }
  if (parsed.data.vectors.length === 0 && reasons.size === 0) reasons.add("missing_vectors");
  return {
    status: "valid",
    coverage: {
      vectors: parsed.data.vectors,
      reasons: sortedReasons(reasons),
      missingVectorCount: missingIds.size,
      invalidVectorCount: invalidIds.size,
      semanticVectorBytesRead: decodedBytes,
    },
  };
}

function expired(input: {
  signal: AbortSignal;
  clock: Lm2SemanticClock;
  deadlineAtMs: number;
}): boolean {
  if (input.signal.aborted) return true;
  try {
    const current = input.clock.now();
    return !Number.isFinite(current) || current >= input.deadlineAtMs;
  } catch {
    return true;
  }
}

function degraded(
  coverage: Lm2SemanticCoverage,
  reasons: Iterable<HybridSemanticReason>,
): Lm2SemanticOutcome {
  return { status: "degraded", coverage, reasons: sortedReasons(reasons) };
}

async function executeSemantic(input: {
  request: Lm2RankRequest & { model: NonNullable<Lm2RankRequest["model"]> };
  candidates: readonly Lm2Candidate[];
  vectors: Lm2RankVectorReader;
  embedding: EmbeddingPort;
  clock: Lm2SemanticClock;
  deadlineAtMs: number;
  signal: AbortSignal;
  remoteApproval?: RemoteEmbeddingApprovalPort;
  approvalRef?: string;
  setCoverage(value: Lm2SemanticCoverage): void;
}): Promise<Lm2SemanticOutcome> {
  const isExpired = () => expired(input);
  if (isExpired()) return degraded(emptyCoverage(), ["timeout"]);
  let readOutput: unknown;
  try {
    readOutput = await input.vectors.read({
      workspaceKey: input.request.workspaceKey,
      model: input.request.model,
      candidates: input.candidates,
      maxDecodedBytes: MAX_DECODED_VECTOR_BYTES,
      signal: input.signal,
      deadlineAtMs: input.deadlineAtMs,
      now: () => input.clock.now(),
    });
  } catch {
    return degraded(emptyCoverage(), [isExpired() ? "timeout" : "vector_read_limit"]);
  }
  if (isExpired()) return degraded(emptyCoverage(), ["timeout"]);
  const parsedRead = parseVectorRead({
    value: readOutput,
    candidates: input.candidates,
    dimensions: input.request.model.dimensions,
  });
  if (parsedRead.status === "invalid") {
    return degraded(parsedRead.reason === "invalid_vectors" ? invalidCoverage() : emptyCoverage(), [
      parsedRead.reason,
    ]);
  }
  const { coverage } = parsedRead;
  input.setCoverage(coverage);
  if (coverage.vectors.length === 0) return degraded(coverage, coverage.reasons);

  const fingerprint = modelDescriptorFingerprint(input.request.model);
  if (input.embedding.egress === "remote") {
    if (input.remoteApproval === undefined || input.approvalRef === undefined || isExpired()) {
      return degraded(coverage, [
        ...coverage.reasons,
        isExpired() ? "timeout" : "remote_approval_denied",
      ]);
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
      return degraded(coverage, [...coverage.reasons, "remote_approval_denied"]);
    }
    if (isExpired()) return degraded(coverage, [...coverage.reasons, "timeout"]);
    if (approval !== "approved") {
      return degraded(coverage, [...coverage.reasons, "remote_approval_denied"]);
    }
  }

  if (isExpired()) return degraded(coverage, [...coverage.reasons, "timeout"]);
  let output: unknown;
  try {
    output = await input.embedding.embed({
      model: input.request.model,
      purpose: "query",
      texts: [input.request.task],
      signal: input.signal,
    });
  } catch {
    return degraded(coverage, [...coverage.reasons, isExpired() ? "timeout" : "port_failure"]);
  }
  if (isExpired()) return degraded(coverage, [...coverage.reasons, "timeout"]);
  const parsed = embeddingOutputSchema.safeParse(output);
  const queryVector = parsed.success ? parsed.data.vectors[0] : undefined;
  if (
    !parsed.success ||
    parsed.data.modelFingerprint !== fingerprint ||
    queryVector === undefined ||
    normalizeLm2Vector(queryVector, input.request.model.dimensions) === null
  ) {
    return degraded(coverage, [...coverage.reasons, "invalid_vectors"]);
  }
  return { status: "ready", coverage, queryVector };
}

export async function runLm2SemanticLane(input: {
  request: Lm2RankRequest & { model: NonNullable<Lm2RankRequest["model"]> };
  candidates: readonly Lm2Candidate[];
  vectors: Lm2RankVectorReader;
  embedding: EmbeddingPort;
  clock: Lm2SemanticClock;
  startedAtMs: number;
  timeoutMs: number;
  remoteApproval?: RemoteEmbeddingApprovalPort;
  approvalRef?: string;
}): Promise<Lm2SemanticOutcome> {
  const controller = new AbortController();
  const deadlineAtMs = input.startedAtMs + input.timeoutMs;
  let current: number;
  try {
    current = input.clock.now();
  } catch {
    controller.abort();
    return degraded(emptyCoverage(), ["timeout"]);
  }
  if (
    !Number.isFinite(deadlineAtMs) ||
    !Number.isFinite(current) ||
    current < input.startedAtMs ||
    current >= deadlineAtMs
  ) {
    controller.abort();
    return degraded(emptyCoverage(), ["timeout"]);
  }
  const remainingMs = Math.max(0, deadlineAtMs - current);
  let latestCoverage = emptyCoverage();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Lm2SemanticOutcome>((resolve) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      resolve(degraded(latestCoverage, [...latestCoverage.reasons, "timeout"]));
    }, remainingMs);
  });
  const operation = executeSemantic({
    ...input,
    deadlineAtMs,
    signal: controller.signal,
    setCoverage(value) {
      latestCoverage = value;
    },
  });
  const result = await Promise.race([operation, timeout]);
  if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  if (controller.signal.aborted) operation.catch(() => undefined);
  return result;
}
