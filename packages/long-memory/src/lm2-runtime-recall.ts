import type { Lm1FusedSelector } from "./lm1-fused-selector.js";
import type { FileLm1Store } from "./lm1-store.js";
import type { Lm2CandidateCatalog } from "./lm2-catalog.js";
import type {
  EmbeddingPort,
  HybridSemanticReason,
  Lm2RuntimeConfig,
  ModelDescriptor,
} from "./lm2-model.js";
import { hybridReceiptSchema } from "./lm2-model.js";
import { rankLm2Candidates } from "./lm2-ranker.js";
import { loadLm2RuntimeCandidates } from "./lm2-runtime-candidates.js";
import type { Lm2RuntimeCapability } from "./lm2-runtime-ports.js";
import type { Lm2RecallBundle, Lm2RecallRequest } from "./lm2-runtime.js";
import type { Lm2SemanticClock } from "./lm2-semantic-lane.js";
import type { Lm2VectorStore } from "./lm2-vector-store.js";

export async function recallLm2Adaptive(input: {
  request: Lm2RecallRequest;
  catalog: Lm2CandidateCatalog;
  store: FileLm1Store;
  vectors: Lm2VectorStore;
  capability: Lm2RuntimeCapability;
  config: Lm2RuntimeConfig;
  activeModel: ModelDescriptor;
  monotonicClock: Lm2SemanticClock;
  selector: Lm1FusedSelector;
  approvalRef: string | undefined;
}): Promise<Lm2RecallBundle> {
  const projection = loadLm2RuntimeCandidates({
    workspaceKey: input.request.workspaceKey,
    catalog: input.catalog,
    store: input.store,
  });
  const degradedReason: HybridSemanticReason | undefined =
    input.capability.status === "unavailable" ? input.capability.reason : undefined;
  const rank = await rankLm2Candidates({
    candidates: projection.candidates,
    request: {
      workspaceKey: input.request.workspaceKey,
      task: input.request.task,
      profile: degradedReason === undefined ? "adaptive" : "safe",
      ...(degradedReason === undefined ? { model: input.activeModel } : {}),
      timeoutMs: input.request.timeoutMs ?? input.config.queryTimeoutMs,
    },
    vectors: input.vectors,
    embedding:
      input.capability.status === "available"
        ? input.capability.embedding
        : ({
            egress: "local",
            embed: async () => {
              throw new Error("unavailable");
            },
          } satisfies EmbeddingPort),
    clock: input.monotonicClock,
    ...(input.capability.status === "available" && input.capability.approval !== undefined
      ? { remoteApproval: input.capability.approval }
      : {}),
    ...(input.approvalRef === undefined ? {} : { approvalRef: input.approvalRef }),
    adaptiveCandidateScope: "lm2_capture_window",
    candidateInputOmittedCount: projection.omittedByCorpusLimit,
  });
  const hybrid =
    degradedReason === undefined
      ? rank.hybrid
      : hybridReceiptSchema.parse({
          ...rank.hybrid,
          profile: "adaptive",
          adaptiveCandidateScope: "lm2_capture_window",
          semanticStatus: "degraded",
          semanticReasons: [degradedReason],
        });
  const selected = await input.selector.select({
    workspaceKey: input.request.workspaceKey,
    task: input.request.task,
    tokenBudget: input.request.tokenBudget,
    candidates: rank.scores,
  });
  return { ...selected, receipt: { ...selected.receipt, hybrid } };
}
