import { isAbsolute } from "node:path";
import { z } from "zod";
import { type Lm1CaptureService, type Lm1Clock, createLm1CaptureService } from "./lm1-capture.js";
import { createLm1FusedSelector } from "./lm1-fused-selector.js";
import type {
  EvidenceBindingPort,
  EvidenceEligibilityPort,
  Lm1RecallBundle,
  Lm1RecallRequest,
  RedactionPort,
} from "./lm1-model.js";
import { lm1RecallRequestSchema } from "./lm1-model.js";
import { createLm1RecallService } from "./lm1-recall.js";
import { type PublishedLm1Record, createFileLm1Store } from "./lm1-store.js";
import { createLm2CandidateCatalog } from "./lm2-catalog.js";
import { Lm2Error } from "./lm2-errors.js";
import { modelDescriptorFingerprint } from "./lm2-identity.js";
import { createLm2IndexService } from "./lm2-index.js";
import {
  type EmbeddingPort,
  type HybridReceipt,
  type Lm2IndexReceipt,
  type Lm2IndexRequest,
  type Lm2RuntimeConfig,
  MAX_LM2_QUERY_TIMEOUT_MS,
  type ModelDescriptor,
  type RemoteEmbeddingApprovalPort,
  hybridReceiptSchema,
  lm2IndexRequestSchema,
  lm2ProfileSchema,
  lm2RuntimeConfigSchema,
} from "./lm2-model.js";
import {
  type Lm2RuntimeCapability,
  readApprovalPort,
  readEmbeddingPort,
} from "./lm2-runtime-ports.js";
import { recallLm2Adaptive } from "./lm2-runtime-recall.js";
import type { Lm2SemanticClock } from "./lm2-semantic-lane.js";
import { createLm2VectorStore } from "./lm2-vector-store.js";

const recallRequestSchema = lm1RecallRequestSchema.extend({
  profile: lm2ProfileSchema,
  timeoutMs: z.number().int().min(1).max(MAX_LM2_QUERY_TIMEOUT_MS).optional(),
});
export type Lm2RecallRequest = z.infer<typeof recallRequestSchema>;
export type Lm2RecallBundle = Omit<Lm1RecallBundle, "receipt"> & {
  receipt: Lm1RecallBundle["receipt"] & { hybrid: HybridReceipt };
};
export type Lm2CaptureService = {
  prepare: Lm1CaptureService["prepare"];
  capturePrepared(input: Parameters<Lm1CaptureService["capturePrepared"]>[0]): Promise<{
    published: PublishedLm1Record;
    adaptiveCataloged: boolean;
  }>;
};
export type Lm2Runtime = {
  capture: Lm2CaptureService;
  recall(request: Lm2RecallRequest): Promise<Lm2RecallBundle>;
  index(request: Lm2IndexRequest): Promise<Lm2IndexReceipt>;
};

export type Lm2RuntimeInput = {
  storeRoot: string;
  redaction: RedactionPort;
  evidenceBinding: EvidenceBindingPort;
  evidenceEligibility: EvidenceEligibilityPort;
  clock: Lm1Clock;
  monotonicClock: Lm2SemanticClock;
  embedding?: EmbeddingPort;
  remoteApproval?: RemoteEmbeddingApprovalPort;
  config: Lm2RuntimeConfig;
};

function invalidInput(): never {
  throw new Lm2Error("invalid_input", "Invalid LM2 runtime input.");
}

function parseFactoryInput(input: Lm2RuntimeInput) {
  let config: ReturnType<typeof lm2RuntimeConfigSchema.safeParse>;
  try {
    config = lm2RuntimeConfigSchema.safeParse(input.config);
  } catch {
    return invalidInput();
  }
  if (!config.success) return invalidInput();
  let values: Omit<Lm2RuntimeInput, "config">;
  try {
    const { config: _config, ...rest } = input;
    values = rest;
  } catch {
    return invalidInput();
  }
  const approvalSupplied = values.remoteApproval !== undefined;
  if (
    (config.data.embeddingEgress === "local" && approvalSupplied) ||
    (config.data.embeddingEgress === "remote" && !approvalSupplied)
  ) {
    return invalidInput();
  }
  if (
    typeof values.storeRoot !== "string" ||
    !isAbsolute(values.storeRoot) ||
    values.redaction === null ||
    typeof values.redaction !== "object" ||
    values.evidenceBinding === null ||
    typeof values.evidenceBinding !== "object" ||
    values.evidenceEligibility === null ||
    typeof values.evidenceEligibility !== "object" ||
    values.clock === null ||
    typeof values.clock !== "object" ||
    values.monotonicClock === null ||
    typeof values.monotonicClock !== "object"
  ) {
    return invalidInput();
  }
  return { ...values, config: config.data };
}

function runtimeCapability(input: ReturnType<typeof parseFactoryInput>): Lm2RuntimeCapability {
  const embedding = readEmbeddingPort(input.embedding);
  if (embedding.status === "unreadable") {
    return { status: "unavailable", reason: "embedding_port_unreadable" };
  }
  if (input.config.embeddingEgress === "remote") {
    const approval = readApprovalPort(input.remoteApproval);
    if (approval.status === "unreadable") {
      return { status: "unavailable", reason: "approval_port_unreadable" };
    }
    if (embedding.value.egress !== "remote") {
      return { status: "unavailable", reason: "embedding_egress_mismatch" };
    }
    return { status: "available", embedding: embedding.value, approval: approval.value };
  }
  return embedding.value.egress === "local"
    ? { status: "available", embedding: embedding.value }
    : { status: "unavailable", reason: "embedding_egress_mismatch" };
}

function safeHybrid(): HybridReceipt {
  return hybridReceiptSchema.parse({
    profile: "safe",
    adaptiveCandidateScope: "not_applicable",
    adaptiveCatalogRecordCount: 0,
    candidateInputOmittedCount: 0,
    lexicalCandidateCount: 0,
    semanticCandidateCount: 0,
    fusedCandidateCount: 0,
    semanticStatus: "not_requested",
    semanticReasons: [],
    indexedVectorCount: 0,
    missingVectorCount: 0,
    invalidVectorCount: 0,
    semanticVectorBytesRead: 0,
    queryLatencyMs: 0,
  });
}

function retryUnavailable(
  request: Lm2IndexRequest,
  reason: Lm2RuntimeCapability & { status: "unavailable" },
): Lm2IndexReceipt {
  return {
    indexedCount: 0,
    omitted: [],
    outcome: "retry",
    nextCursor: null,
    retryCursor: request.cursor ?? null,
    transientReason:
      reason.reason === "approval_port_unreadable" ? "remote_approval_denied" : "embedding_failure",
    quotaRecovery: "not_needed",
  };
}

function approvalRef(config: Lm2RuntimeConfig, workspaceKey: string, fingerprint: string) {
  return config.remoteApprovals.find(
    (approval) =>
      approval.workspaceKey === workspaceKey && approval.modelFingerprint === fingerprint,
  )?.approvalRef;
}

export function createLm2Runtime(input: Lm2RuntimeInput): Lm2Runtime {
  const parsed = parseFactoryInput(input);
  const capability = runtimeCapability(parsed);
  const store = createFileLm1Store({ storeRoot: parsed.storeRoot });
  const catalog = createLm2CandidateCatalog({ storeRoot: parsed.storeRoot });
  const vectors = createLm2VectorStore({ storeRoot: parsed.storeRoot });
  const capture = createLm1CaptureService({ ...parsed, store });
  const safeRecall = createLm1RecallService({
    store,
    evidenceEligibility: parsed.evidenceEligibility,
  });
  const selector = createLm1FusedSelector({
    store,
    evidenceEligibility: parsed.evidenceEligibility,
  });
  const models = new Map<string, ModelDescriptor>(
    parsed.config.admittedModels.map((model) => [modelDescriptorFingerprint(model), model]),
  );
  const activeModel = models.get(parsed.config.activeRecallModelFingerprint) as ModelDescriptor;

  return {
    capture: {
      prepare: capture.prepare,
      async capturePrepared(request) {
        const published = await capture.capturePrepared(request);
        let adaptiveCataloged = false;
        try {
          adaptiveCataloged = catalog.appendPublished(published.record);
        } catch {
          adaptiveCataloged = false;
        }
        return { published, adaptiveCataloged };
      },
    },
    async recall(request) {
      const result = recallRequestSchema.safeParse(request);
      if (!result.success) throw new Lm2Error("invalid_input", "Invalid LM2 recall request.");
      if (result.data.profile === "safe") {
        const { profile: _profile, timeoutMs: _timeout, ...lm1Request } = result.data;
        const recalled = await safeRecall.recall(lm1Request as Lm1RecallRequest);
        return { ...recalled, receipt: { ...recalled.receipt, hybrid: safeHybrid() } };
      }
      return recallLm2Adaptive({
        request: result.data,
        catalog,
        store,
        vectors,
        capability,
        config: parsed.config,
        activeModel,
        monotonicClock: parsed.monotonicClock,
        selector,
        approvalRef: approvalRef(
          parsed.config,
          result.data.workspaceKey,
          parsed.config.activeRecallModelFingerprint,
        ),
      });
    },
    async index(request) {
      const result = lm2IndexRequestSchema.safeParse(request);
      const model = result.success ? models.get(result.data.modelFingerprint) : undefined;
      if (!result.success || model === undefined) {
        throw new Lm2Error("invalid_input", "Invalid LM2 index request.");
      }
      if (capability.status === "unavailable") return retryUnavailable(result.data, capability);
      const ref = approvalRef(
        parsed.config,
        result.data.workspaceKey,
        result.data.modelFingerprint,
      );
      if (capability.embedding.egress === "remote" && ref === undefined) {
        return retryUnavailable(result.data, {
          status: "unavailable",
          reason: "approval_port_unreadable",
        });
      }
      return createLm2IndexService({
        catalog,
        store,
        vectors,
        evidenceEligibility: parsed.evidenceEligibility,
        embedding: capability.embedding,
        model,
        defaultTimeoutMs: parsed.config.indexBatchTimeoutMs,
        ...(capability.approval === undefined ? {} : { remoteApproval: capability.approval }),
        ...(ref === undefined ? {} : { approvalRef: ref }),
      }).index(result.data);
    },
  };
}
