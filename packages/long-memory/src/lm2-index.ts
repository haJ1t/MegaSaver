import {
  type EvidenceEligibilityPort,
  type Lm1Record,
  type Lm1Snapshot,
  evidenceEligibilityResultSchema,
  lm1RecordSchema,
} from "./lm1-model.js";
import type { FileLm1Store } from "./lm1-store.js";
import type { Lm2CandidateCatalog, Lm2CatalogEntry } from "./lm2-catalog.js";
import { Lm2Error } from "./lm2-errors.js";
import { modelDescriptorFingerprint } from "./lm2-identity.js";
import {
  type EmbeddingPort,
  type Lm2Candidate,
  type Lm2IndexReceipt,
  type Lm2IndexRequest,
  type ModelDescriptor,
  type RemoteEmbeddingApprovalPort,
  lm2IndexRequestSchema,
  modelDescriptorSchema,
} from "./lm2-model.js";
import { canonicalEmbeddingInput } from "./lm2-vector-format.js";
import type { Lm2VectorStore, Lm2VectorStoreResult } from "./lm2-vector-store.js";

const MAX_CATALOG_ENTRIES_PER_CALL = 1_024;
const MAX_DIRECT_RECORD_READS_PER_CALL = 1_024;
const MAX_RAW_TEXT_BYTES_PER_CALL = 16 * 1024 * 1024;
const MAX_DISTINCT_EVIDENCE_PER_CALL = 256;
const MAX_DOCUMENTS_PER_BATCH = 16;
const MAX_DOCUMENT_INPUT_CODE_UNITS = 8_192;
const MAX_BATCH_INPUT_CODE_UNITS = 65_536;

export type Lm2IndexService = {
  index(request: Lm2IndexRequest): Promise<Lm2IndexReceipt>;
};

type IndexServiceInput = {
  catalog: Lm2CandidateCatalog;
  store: FileLm1Store;
  vectors: Pick<Lm2VectorStore, "reserveAndPublish">;
  evidenceEligibility: EvidenceEligibilityPort;
  embedding: EmbeddingPort;
  model: ModelDescriptor;
  remoteApproval?: RemoteEmbeddingApprovalPort;
  approvalRef?: string;
  defaultTimeoutMs: number;
};

type AdmissionContext = {
  record: Lm1Record;
  candidate: Lm2Candidate;
  requiredEvidenceIds: readonly string[];
};

type Admission =
  | { type: "eligible"; context: AdmissionContext }
  | { type: "terminal"; reason: string }
  | { type: "transient" };

type PendingRecord = AdmissionContext & {
  cursorBefore: string | null;
  cursorAfter: string | null;
};

class ApprovalDeniedError extends Error {}
class EligibilityChangedError extends Error {}

function toCandidate(record: Lm1Record): Lm2Candidate {
  return {
    id: record.id,
    workspaceKey: record.workspaceKey,
    observedAt: record.observedAt,
    kind: record.kind,
    text: record.text,
    sourceDigest: record.sourceDigest,
  };
}

function catalogTupleMatches(entry: Lm2CatalogEntry, record: Lm1Record): boolean {
  return (
    entry.id === record.id &&
    entry.sourceDigest === record.sourceDigest &&
    entry.kind === record.kind &&
    entry.observedAt === record.observedAt
  );
}

function validTransitionEndpoints(
  transition: Extract<Lm1Record, { kind: "state_transition" }>,
  pre: Lm1Record,
  post: Lm1Record,
): pre is Lm1Snapshot {
  return (
    pre.kind === "state_snapshot" &&
    post.kind === "state_snapshot" &&
    pre.workspaceKey === transition.workspaceKey &&
    post.workspaceKey === transition.workspaceKey &&
    pre.id === transition.preSnapshotId &&
    post.id === transition.postSnapshotId &&
    pre.id !== post.id &&
    pre.stateKey === post.stateKey &&
    pre.observedAt <= transition.observedAt &&
    transition.observedAt <= post.observedAt
  );
}

function eligibilityIsCurrent(
  workspaceKey: string,
  evidenceIds: readonly string[],
  value: unknown,
): boolean {
  const parsed = evidenceEligibilityResultSchema.safeParse(value);
  return (
    parsed.success &&
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

function parseFactory(input: IndexServiceInput): { model: ModelDescriptor; fingerprint: string } {
  const model = modelDescriptorSchema.safeParse(input.model);
  if (
    !model.success ||
    !Number.isInteger(input.defaultTimeoutMs) ||
    input.defaultTimeoutMs < 1 ||
    input.defaultTimeoutMs > 15_000 ||
    (input.embedding.egress === "remote" &&
      (input.remoteApproval === undefined ||
        typeof input.approvalRef !== "string" ||
        input.approvalRef.trim().length === 0))
  ) {
    throw new Lm2Error("invalid_config", "Invalid LM2 index configuration.");
  }
  return { model: model.data, fingerprint: modelDescriptorFingerprint(model.data) };
}

export function createLm2IndexService(input: IndexServiceInput): Lm2IndexService {
  const { model, fingerprint } = parseFactory(input);

  return {
    async index(request) {
      const parsed = lm2IndexRequestSchema.safeParse(request);
      if (!parsed.success || parsed.data.modelFingerprint !== fingerprint) {
        throw new Lm2Error("invalid_input", "Invalid LM2 index request.");
      }

      const omitted: { id: string; reason: string }[] = [];
      const recordCache = new Map<string, Lm1Record>();
      const resolvedEvidenceIds = new Set<string>();
      let catalogEntriesRead = 0;
      let directReads = 0;
      let rawTextBytes = 0;
      let admittedRecords = 0;
      let indexedCount = 0;
      let scanCursor = parsed.data.cursor ?? null;
      let pending: PendingRecord[] = [];
      let pendingCodeUnits = 0;

      const readRecord = (id: string): Lm1Record | null | "limit" => {
        const cached = recordCache.get(id);
        if (cached !== undefined) return cached;
        if (directReads === MAX_DIRECT_RECORD_READS_PER_CALL) return "limit";
        directReads += 1;
        let raw: unknown;
        try {
          raw = input.store.getById(parsed.data.workspaceKey, id);
        } catch {
          return null;
        }
        const record = lm1RecordSchema.safeParse(raw);
        if (!record.success || record.data.workspaceKey !== parsed.data.workspaceKey) return null;
        const bytes = Buffer.byteLength(record.data.text, "utf8");
        if (rawTextBytes + bytes > MAX_RAW_TEXT_BYTES_PER_CALL) return "limit";
        rawTextBytes += bytes;
        recordCache.set(id, record.data);
        return record.data;
      };

      const admit = async (entry: Lm2CatalogEntry): Promise<Admission> => {
        const record = readRecord(entry.id);
        if (record === "limit") return { type: "transient" };
        if (record === null || !catalogTupleMatches(entry, record)) {
          return { type: "terminal", reason: "record_unavailable" };
        }
        const candidate = toCandidate(record);
        const projectionCodeUnits = canonicalEmbeddingInput(candidate).length;
        if (projectionCodeUnits > MAX_DOCUMENT_INPUT_CODE_UNITS) {
          return { type: "terminal", reason: "input_limit" };
        }

        let requiredEvidenceIds = record.evidenceIds;
        if (record.kind === "state_transition") {
          const pre = readRecord(record.preSnapshotId);
          const post = readRecord(record.postSnapshotId);
          if (pre === "limit" || post === "limit") return { type: "transient" };
          if (pre === null || post === null || !validTransitionEndpoints(record, pre, post)) {
            return { type: "terminal", reason: "invalid_transition" };
          }
          requiredEvidenceIds = [
            ...new Set([...record.evidenceIds, ...pre.evidenceIds, ...post.evidenceIds]),
          ].sort();
        }
        const newEvidenceIds = requiredEvidenceIds.filter((id) => !resolvedEvidenceIds.has(id));
        if (resolvedEvidenceIds.size + newEvidenceIds.length > MAX_DISTINCT_EVIDENCE_PER_CALL) {
          return { type: "transient" };
        }
        for (const id of newEvidenceIds) resolvedEvidenceIds.add(id);
        let eligibility: unknown;
        try {
          eligibility = await input.evidenceEligibility.resolve({
            workspaceKey: parsed.data.workspaceKey,
            evidenceIds: requiredEvidenceIds,
          });
        } catch {
          return { type: "transient" };
        }
        if (!eligibilityIsCurrent(parsed.data.workspaceKey, requiredEvidenceIds, eligibility)) {
          return { type: "terminal", reason: "evidence_ineligible" };
        }
        return {
          type: "eligible",
          context: { record, candidate, requiredEvidenceIds },
        };
      };

      const recheckBatch = async (batch: readonly PendingRecord[]): Promise<boolean> => {
        for (const item of batch) {
          let result: unknown;
          try {
            result = await input.evidenceEligibility.resolve({
              workspaceKey: parsed.data.workspaceKey,
              evidenceIds: item.requiredEvidenceIds,
            });
          } catch {
            return false;
          }
          if (!eligibilityIsCurrent(parsed.data.workspaceKey, item.requiredEvidenceIds, result)) {
            return false;
          }
        }
        return true;
      };

      const runBatch = async (
        batch: readonly PendingRecord[],
      ): Promise<{ type: "advanced"; cursor: string | null } | { type: "transient" }> => {
        if (batch.length === 0) return { type: "advanced", cursor: scanCursor };
        const controller = new AbortController();
        let dispatchFailure: "approval" | "eligibility" | null = null;
        const guardedEmbed: EmbeddingPort["embed"] = async (call) => {
          if (input.embedding.egress === "remote") {
            let approval: Awaited<ReturnType<RemoteEmbeddingApprovalPort["assertCurrent"]>>;
            try {
              approval = await (input.remoteApproval as RemoteEmbeddingApprovalPort).assertCurrent({
                workspaceKey: parsed.data.workspaceKey,
                modelFingerprint: fingerprint,
                purpose: "document",
                approvalRef: input.approvalRef as string,
              });
            } catch {
              dispatchFailure = "approval";
              throw new ApprovalDeniedError();
            }
            if (approval !== "approved") {
              dispatchFailure = "approval";
              throw new ApprovalDeniedError();
            }
          }
          if (controller.signal.aborted) throw new Error("aborted");
          const result = await input.embedding.embed({ ...call, signal: controller.signal });
          if (controller.signal.aborted) throw new Error("aborted");
          if (!(await recheckBatch(batch))) {
            dispatchFailure = "eligibility";
            throw new EligibilityChangedError();
          }
          return result;
        };

        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<"timeout">((resolve) => {
          timeoutHandle = setTimeout(() => {
            controller.abort();
            resolve("timeout");
          }, parsed.data.timeoutMs ?? input.defaultTimeoutMs);
        });
        const operation = input.vectors
          .reserveAndPublish({
            workspaceKey: parsed.data.workspaceKey,
            model,
            records: batch.map((item) => item.candidate),
            signal: controller.signal,
            embed: guardedEmbed,
          })
          .catch((): Lm2VectorStoreResult => ({ published: [], reason: "port_failure" }));
        const outcome = await Promise.race([operation, timeout]);
        if (outcome === "timeout") {
          operation.catch(() => undefined);
          return { type: "transient" };
        }
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        if (dispatchFailure !== null) return { type: "transient" };
        const result = outcome as Lm2VectorStoreResult;
        if (
          result.reason === "index_busy" ||
          result.reason === "index_lock_unavailable" ||
          result.reason === "port_failure" ||
          result.reason === "invalid_vectors"
        ) {
          return { type: "transient" };
        }
        const published = new Set(result.published);
        indexedCount += published.size;
        for (const item of batch) {
          if (published.has(item.candidate.id)) continue;
          omitted.push({
            id: item.candidate.id,
            reason:
              result.reason === "storage_limit"
                ? "storage_limit"
                : result.reason === "write_failed"
                  ? "sidecar_invalid"
                  : "already_indexed",
          });
        }
        return { type: "advanced", cursor: batch.at(-1)?.cursorAfter ?? scanCursor };
      };

      const flush = async (): Promise<boolean> => {
        if (pending.length === 0) return true;
        const batch = pending;
        const result = await runBatch(batch);
        if (result.type === "transient") return false;
        scanCursor = result.cursor;
        pending = [];
        pendingCodeUnits = 0;
        return true;
      };

      while (catalogEntriesRead < MAX_CATALOG_ENTRIES_PER_CALL) {
        if (admittedRecords === parsed.data.maxRecords) {
          const retryCursor = pending[0]?.cursorBefore ?? scanCursor;
          if (!(await flush())) {
            return { indexedCount, omitted, nextCursor: retryCursor };
          }
          return { indexedCount, omitted, nextCursor: scanCursor };
        }
        const cursorBefore = scanCursor;
        const page = input.catalog.page({
          workspaceKey: parsed.data.workspaceKey,
          cursor: scanCursor,
          limit: 1,
        });
        catalogEntriesRead += 1;
        const entry = page.entries[0];
        if (entry === undefined) {
          const retryCursor = pending[0]?.cursorBefore ?? scanCursor;
          if (!(await flush())) return { indexedCount, omitted, nextCursor: retryCursor };
          return { indexedCount, omitted, nextCursor: page.nextCursor };
        }
        const admission = await admit(entry);
        if (admission.type === "transient") {
          const retryCursor = pending[0]?.cursorBefore ?? cursorBefore;
          if (!(await flush())) return { indexedCount, omitted, nextCursor: retryCursor };
          return { indexedCount, omitted, nextCursor: cursorBefore };
        }
        if (admission.type === "terminal") {
          const retryCursor = pending[0]?.cursorBefore ?? cursorBefore;
          if (!(await flush())) return { indexedCount, omitted, nextCursor: retryCursor };
          omitted.push({ id: entry.id, reason: admission.reason });
          scanCursor = page.nextCursor;
          if (scanCursor === null) return { indexedCount, omitted, nextCursor: null };
          continue;
        }

        const projectionCodeUnits = canonicalEmbeddingInput(admission.context.candidate).length;
        if (
          pending.length === MAX_DOCUMENTS_PER_BATCH ||
          pendingCodeUnits + projectionCodeUnits > MAX_BATCH_INPUT_CODE_UNITS
        ) {
          const retryCursor = pending[0]?.cursorBefore ?? cursorBefore;
          if (!(await flush())) return { indexedCount, omitted, nextCursor: retryCursor };
        }
        pending.push({
          ...admission.context,
          cursorBefore,
          cursorAfter: page.nextCursor,
        });
        pendingCodeUnits += projectionCodeUnits;
        admittedRecords += 1;
        scanCursor = page.nextCursor;
        if (scanCursor === null) {
          const retryCursor = pending[0]?.cursorBefore ?? cursorBefore;
          if (!(await flush())) return { indexedCount, omitted, nextCursor: retryCursor };
          return { indexedCount, omitted, nextCursor: null };
        }
      }

      const retryCursor = pending[0]?.cursorBefore ?? scanCursor;
      if (!(await flush())) return { indexedCount, omitted, nextCursor: retryCursor };
      return { indexedCount, omitted, nextCursor: scanCursor };
    },
  };
}
