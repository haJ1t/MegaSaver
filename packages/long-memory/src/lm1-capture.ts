import { Lm1Error } from "./lm1-errors.js";
import {
  canonicalCaptureDigest,
  deriveEvidenceBindingDigest,
  deriveLm1RecordId,
} from "./lm1-identity.js";
import {
  type EvidenceBindingPort,
  type EvidenceEligibilityPort,
  type Lm1Record,
  type PrepareCaptureInput,
  type PreparedCapture,
  type RedactionPort,
  evidenceBindingResultSchema,
  evidenceEligibilityResultSchema,
  prepareCapture,
  preparedCaptureSchema,
} from "./lm1-model.js";
import type { FileLm1Store, PublishedLm1Record } from "./lm1-store.js";

export type Lm1Clock = { now(): string };

export type Lm1CaptureService = {
  prepare(input: PrepareCaptureInput): PreparedCapture;
  capturePrepared(input: {
    prepared: PreparedCapture;
    authorization: string;
  }): Promise<PublishedLm1Record>;
};

function assertBinding(evidenceIds: readonly string[], binding: unknown): readonly string[] {
  const parsed = evidenceBindingResultSchema.safeParse(binding);
  if (!parsed.success || parsed.data.evidence.length !== evidenceIds.length) {
    throw new Lm1Error("evidence_binding_invalid", "Evidence binding is incomplete.");
  }
  const evidenceDigests: string[] = [];
  for (const [index, evidence] of parsed.data.evidence.entries()) {
    if (evidence.evidenceId !== evidenceIds[index]) {
      throw new Lm1Error("evidence_binding_invalid", "Evidence binding is out of order.");
    }
    evidenceDigests.push(evidence.evidenceDigest);
  }
  return evidenceDigests;
}

function assertEligibility(
  workspaceKey: string,
  evidenceIds: readonly string[],
  eligibility: unknown,
): void {
  const parsed = evidenceEligibilityResultSchema.safeParse(eligibility);
  if (!parsed.success) {
    throw new Lm1Error("store_corrupt", "Evidence eligibility response is invalid.");
  }
  if (parsed.data.length !== evidenceIds.length) {
    throw new Lm1Error("evidence_unavailable", "Evidence eligibility is incomplete.");
  }
  for (const [index, evidence] of parsed.data.entries()) {
    if (
      evidence.evidenceId !== evidenceIds[index] ||
      evidence.workspaceKey !== workspaceKey ||
      evidence.status !== "available" ||
      evidence.unresolvedHighRisk
    ) {
      throw new Lm1Error("evidence_unavailable", "Evidence is not eligible.");
    }
  }
}

function mapPortError(error: unknown): never {
  if (error instanceof Lm1Error) throw error;
  throw new Lm1Error("store_corrupt", "Evidence port failed.");
}

function buildRecord(
  prepared: PreparedCapture,
  evidenceDigests: readonly string[],
  recordedAt: string,
): Lm1Record {
  const sourceDigest = canonicalCaptureDigest(prepared);
  if (sourceDigest !== prepared.canonicalCaptureDigest) {
    throw new Lm1Error("evidence_binding_invalid", "Prepared capture digest mismatch.");
  }
  const record = {
    ...prepared,
    id: deriveLm1RecordId(prepared.workspaceKey, prepared.kind, sourceDigest),
    sourceDigest,
    evidenceBindingDigest: deriveEvidenceBindingDigest({
      workspaceKey: prepared.workspaceKey,
      canonicalCaptureDigest: sourceDigest,
      evidenceIds: prepared.evidenceIds,
      evidenceDigests,
    }),
    recordedAt: new Date(recordedAt).toISOString(),
    evidenceDigests: [...evidenceDigests],
    status: "recorded" as const,
  };
  return record as Lm1Record;
}

function assertReferences(store: FileLm1Store, prepared: PreparedCapture): void {
  try {
    if (prepared.kind === "state_snapshot") {
      if (prepared.supersedesSnapshotId === null) return;
      const previous = store.getById(prepared.workspaceKey, prepared.supersedesSnapshotId);
      if (
        previous.kind !== "state_snapshot" ||
        previous.stateKey !== prepared.stateKey ||
        previous.observedAt >= prepared.observedAt
      ) {
        throw new Lm1Error("invalid_transition", "Invalid snapshot correction.");
      }
      return;
    }

    if (prepared.preSnapshotId === prepared.postSnapshotId) {
      throw new Lm1Error("invalid_transition", "Transition cannot reference itself.");
    }
    const pre = store.getById(prepared.workspaceKey, prepared.preSnapshotId);
    const post = store.getById(prepared.workspaceKey, prepared.postSnapshotId);
    if (
      pre.kind !== "state_snapshot" ||
      post.kind !== "state_snapshot" ||
      pre.stateKey !== post.stateKey ||
      !(pre.observedAt <= prepared.observedAt && prepared.observedAt <= post.observedAt)
    ) {
      throw new Lm1Error("invalid_transition", "Invalid transition endpoints.");
    }
  } catch (error) {
    if (error instanceof Lm1Error && error.code === "invalid_transition") throw error;
    throw new Lm1Error("invalid_transition", "Transition references are unavailable.");
  }
}

export function createLm1CaptureService(input: {
  store: FileLm1Store;
  redaction: RedactionPort;
  evidenceBinding: EvidenceBindingPort;
  evidenceEligibility: EvidenceEligibilityPort;
  clock: Lm1Clock;
}): Lm1CaptureService {
  return {
    prepare(captureInput) {
      return prepareCapture(captureInput, input.redaction);
    },
    async capturePrepared(captureInput) {
      const prepared = preparedCaptureSchema.safeParse(captureInput.prepared);
      if (!prepared.success)
        throw new Lm1Error("evidence_binding_invalid", "Invalid prepared capture.");
      const sourceDigest = canonicalCaptureDigest(prepared.data);
      if (sourceDigest !== prepared.data.canonicalCaptureDigest) {
        throw new Lm1Error("evidence_binding_invalid", "Prepared capture digest mismatch.");
      }

      let binding: Awaited<ReturnType<EvidenceBindingPort["verify"]>>;
      try {
        binding = await input.evidenceBinding.verify({
          workspaceKey: prepared.data.workspaceKey,
          canonicalCaptureDigest: sourceDigest,
          evidenceIds: prepared.data.evidenceIds,
          authorization: captureInput.authorization,
        });
      } catch (error) {
        mapPortError(error);
      }
      const evidenceDigests = assertBinding(prepared.data.evidenceIds, binding);

      let eligibility: Awaited<ReturnType<EvidenceEligibilityPort["resolve"]>>;
      try {
        eligibility = await input.evidenceEligibility.resolve({
          workspaceKey: prepared.data.workspaceKey,
          evidenceIds: prepared.data.evidenceIds,
        });
      } catch (error) {
        mapPortError(error);
      }
      assertEligibility(prepared.data.workspaceKey, prepared.data.evidenceIds, eligibility);

      assertReferences(input.store, prepared.data);

      return input.store.publish(buildRecord(prepared.data, evidenceDigests, input.clock.now()));
    },
  };
}
