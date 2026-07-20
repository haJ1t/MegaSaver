import {
  type EvidenceEligibilityPort,
  type Lm1Record,
  type Lm1Snapshot,
  evidenceEligibilityResultSchema,
  lm1RecordSchema,
} from "./lm1-model.js";
import type { FileLm1Store } from "./lm1-store.js";
import type { Lm2CatalogEntry, Lm2CatalogPage } from "./lm2-catalog.js";
import { Lm2Error } from "./lm2-errors.js";
import { modelDescriptorFingerprint } from "./lm2-identity.js";
import {
  type EmbeddingPort,
  type Lm2Candidate,
  type ModelDescriptor,
  type RemoteEmbeddingApprovalPort,
  modelDescriptorSchema,
} from "./lm2-model.js";
import { canonicalEmbeddingInput } from "./lm2-vector-format.js";

const MAX_DIRECT_RECORD_READS = 1_024;
const MAX_RAW_TEXT_BYTES = 16 * 1024 * 1024;
const MAX_DISTINCT_EVIDENCE = 256;
export const MAX_LM2_DOCUMENT_INPUT_CODE_UNITS = 8_192;

export type Lm2AdmittedIndexRecord = {
  candidate: Lm2Candidate;
  requiredEvidenceIds: readonly string[];
};

export type Lm2IndexAdmissionResult =
  | { type: "eligible"; record: Lm2AdmittedIndexRecord }
  | {
      type: "terminal";
      reason: "evidence_ineligible" | "input_limit" | "invalid_transition" | "record_unavailable";
    }
  | { type: "capacity" }
  | { type: "retry"; reason: "evidence_cap_exhausted" | "evidence_changed" | "timeout" };

function encodeCatalogCursor(
  workspaceKey: string,
  generation: number,
  entry: Lm2CatalogEntry,
): string {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      workspaceKey,
      generation,
      nextCaptureSequence: entry.captureSequence,
    }),
    "utf8",
  ).toString("base64url");
}

export function cursorBeforeCatalogEntry(input: {
  workspaceKey: string;
  origin: string | null;
  page: Lm2CatalogPage;
  index: number;
}): string | null {
  if (input.index === 0) return input.origin;
  const entry = input.page.entries[input.index];
  return entry === undefined
    ? input.page.nextCursor
    : encodeCatalogCursor(input.workspaceKey, input.page.generation, entry);
}

export function cursorAfterCatalogEntry(input: {
  workspaceKey: string;
  page: Lm2CatalogPage;
  index: number;
}): string | null {
  const next = input.page.entries[input.index + 1];
  return next === undefined
    ? input.page.nextCursor
    : encodeCatalogCursor(input.workspaceKey, input.page.generation, next);
}

export function isOrderedCanonicalProjectionSubset(
  expected: readonly string[],
  actual: readonly string[],
): boolean {
  let offset = 0;
  return (
    actual.length > 0 &&
    actual.every((value) => {
      const index = expected.indexOf(value, offset);
      offset = index + 1;
      return index >= 0;
    })
  );
}

export function parseLm2IndexFactory(input: {
  model: ModelDescriptor;
  embedding: EmbeddingPort;
  remoteApproval?: RemoteEmbeddingApprovalPort;
  approvalRef?: string;
  defaultTimeoutMs: number;
}): { model: ModelDescriptor; fingerprint: string } {
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

type ReadResult =
  | { type: "record"; record: Lm1Record }
  | { type: "missing" }
  | { type: "capacity" };

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

function currentEligibility(
  workspaceKey: string,
  evidenceIds: readonly string[],
  value: unknown,
): "current" | "ineligible" | "invalid" {
  const parsed = evidenceEligibilityResultSchema.safeParse(value);
  if (!parsed.success || parsed.data.length !== evidenceIds.length) return "invalid";
  for (const [index, expectedId] of evidenceIds.entries()) {
    const entry = parsed.data[index];
    if (
      entry === undefined ||
      entry.evidenceId !== expectedId ||
      entry.workspaceKey !== workspaceKey
    ) {
      return "invalid";
    }
    if (entry.status !== "available" || entry.unresolvedHighRisk) return "ineligible";
  }
  return "current";
}

async function resolveBeforeDeadline(input: {
  resolve(): Promise<unknown>;
  signal: AbortSignal;
  expired: Promise<void>;
}): Promise<{ type: "value"; value: unknown } | { type: "error" } | { type: "timeout" }> {
  if (input.signal.aborted) return { type: "timeout" };
  const resolution = input
    .resolve()
    .then((value) => ({ type: "value" as const, value }))
    .catch(() => ({ type: "error" as const }));
  const result = await Promise.race([
    resolution,
    input.expired.then(() => ({ type: "timeout" as const })),
  ]);
  return input.signal.aborted ? { type: "timeout" } : result;
}

export function createLm2IndexAdmission(input: {
  workspaceKey: string;
  store: FileLm1Store;
  evidenceEligibility: EvidenceEligibilityPort;
  signal: AbortSignal;
  expired: Promise<void>;
}) {
  const recordCache = new Map<string, Lm1Record>();
  const evidenceByCandidate = new Map<string, readonly string[]>();
  const resolvedEvidenceIds = new Set<string>();
  let directReads = 0;
  let rawTextBytes = 0;

  const readRecord = (id: string): ReadResult => {
    const cached = recordCache.get(id);
    if (cached !== undefined) return { type: "record", record: cached };
    if (directReads >= MAX_DIRECT_RECORD_READS) return { type: "capacity" };
    directReads += 1;
    let raw: unknown;
    try {
      raw = input.store.getById(input.workspaceKey, id);
    } catch {
      return { type: "missing" };
    }
    const parsed = lm1RecordSchema.safeParse(raw);
    if (!parsed.success || parsed.data.workspaceKey !== input.workspaceKey)
      return { type: "missing" };
    const bytes = Buffer.byteLength(parsed.data.text, "utf8");
    if (rawTextBytes + bytes > MAX_RAW_TEXT_BYTES) return { type: "capacity" };
    rawTextBytes += bytes;
    recordCache.set(id, parsed.data);
    return { type: "record", record: parsed.data };
  };

  const resolveEvidence = async (
    evidenceIds: readonly string[],
  ): Promise<"current" | "ineligible" | "invalid" | "timeout"> => {
    const result = await resolveBeforeDeadline({
      signal: input.signal,
      expired: input.expired,
      resolve: () =>
        input.evidenceEligibility.resolve({ workspaceKey: input.workspaceKey, evidenceIds }),
    });
    if (result.type !== "value") return result.type === "timeout" ? "timeout" : "invalid";
    return currentEligibility(input.workspaceKey, evidenceIds, result.value);
  };

  return {
    async admit(entry: Lm2CatalogEntry): Promise<Lm2IndexAdmissionResult> {
      if (input.signal.aborted) return { type: "retry", reason: "timeout" };
      const primary = readRecord(entry.id);
      if (primary.type === "capacity") return { type: "capacity" };
      if (primary.type === "missing" || !catalogTupleMatches(entry, primary.record)) {
        return { type: "terminal", reason: "record_unavailable" };
      }
      const candidate = toCandidate(primary.record);
      if (canonicalEmbeddingInput(candidate).length > MAX_LM2_DOCUMENT_INPUT_CODE_UNITS) {
        return { type: "terminal", reason: "input_limit" };
      }

      let requiredEvidenceIds = primary.record.evidenceIds;
      if (primary.record.kind === "state_transition") {
        const pre = readRecord(primary.record.preSnapshotId);
        const post = readRecord(primary.record.postSnapshotId);
        if (pre.type === "capacity" || post.type === "capacity") return { type: "capacity" };
        if (
          pre.type === "missing" ||
          post.type === "missing" ||
          !validTransitionEndpoints(primary.record, pre.record, post.record)
        ) {
          return { type: "terminal", reason: "invalid_transition" };
        }
        requiredEvidenceIds = [
          ...new Set([
            ...primary.record.evidenceIds,
            ...pre.record.evidenceIds,
            ...post.record.evidenceIds,
          ]),
        ].sort();
      }
      const unseen = requiredEvidenceIds.filter((id) => !resolvedEvidenceIds.has(id));
      if (resolvedEvidenceIds.size + unseen.length > MAX_DISTINCT_EVIDENCE) {
        return { type: "retry", reason: "evidence_cap_exhausted" };
      }
      const eligibility = await resolveEvidence(requiredEvidenceIds);
      if (eligibility === "timeout") return { type: "retry", reason: "timeout" };
      if (eligibility === "invalid") return { type: "retry", reason: "evidence_changed" };
      if (eligibility === "ineligible") {
        return { type: "terminal", reason: "evidence_ineligible" };
      }
      for (const id of unseen) resolvedEvidenceIds.add(id);
      evidenceByCandidate.set(candidate.id, requiredEvidenceIds);
      return { type: "eligible", record: { candidate, requiredEvidenceIds } };
    },
    async recheck(candidate: Lm2Candidate): Promise<boolean> {
      const evidenceIds = evidenceByCandidate.get(candidate.id);
      if (evidenceIds === undefined || input.signal.aborted) return false;
      return (await resolveEvidence(evidenceIds)) === "current";
    },
  };
}
