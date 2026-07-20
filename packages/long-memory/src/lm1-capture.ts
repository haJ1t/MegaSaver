import { z } from "zod";
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

const clockTimestampSchema = z.string().datetime({ offset: true });

export type Lm1CaptureService = {
  prepare(input: PrepareCaptureInput): PreparedCapture;
  capturePrepared(input: {
    prepared: PreparedCapture;
    authorization: string;
  }): Promise<PublishedLm1Record>;
};

function parseCapturePreparedInput(input: unknown): {
  prepared: PreparedCapture;
  authorization: string;
} {
  let preparedInput: unknown;
  let authorization: unknown;
  try {
    if (input === null || typeof input !== "object") {
      throw new Error("Invalid LM1 capture request.");
    }
    ({ prepared: preparedInput, authorization } = input as {
      prepared: unknown;
      authorization: unknown;
    });
  } catch {
    throw new Lm1Error("invalid_input", "Invalid LM1 capture request.");
  }
  let prepared: ReturnType<typeof preparedCaptureSchema.safeParse>;
  try {
    prepared = preparedCaptureSchema.safeParse(preparedInput);
  } catch {
    throw new Lm1Error("invalid_input", "Invalid LM1 capture request.");
  }
  if (!prepared.success || typeof authorization !== "string") {
    throw new Lm1Error("invalid_input", "Invalid LM1 capture request.");
  }
  return { prepared: prepared.data, authorization };
}

function assertBinding(evidenceIds: readonly string[], binding: unknown): readonly string[] {
  let parsed: ReturnType<typeof evidenceBindingResultSchema.safeParse>;
  try {
    parsed = evidenceBindingResultSchema.safeParse(binding);
  } catch {
    throw new Lm1Error("store_corrupt", "Evidence binding response is unreadable.");
  }
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
  let parsed: ReturnType<typeof evidenceEligibilityResultSchema.safeParse>;
  try {
    parsed = evidenceEligibilityResultSchema.safeParse(eligibility);
  } catch {
    throw new Lm1Error("store_corrupt", "Evidence eligibility response is unreadable.");
  }
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
  void error;
  throw new Lm1Error("store_corrupt", "Evidence port failed.");
}

function mapClockError(error: unknown): never {
  void error;
  throw new Lm1Error("store_corrupt", "Long-memory clock failed.");
}

function buildRecord(
  prepared: PreparedCapture,
  evidenceDigests: readonly string[],
  recordedAt: unknown,
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
    recordedAt: canonicalRecordedAt(recordedAt),
    evidenceDigests: [...evidenceDigests],
    status: "recorded" as const,
  };
  return record as Lm1Record;
}

function canonicalRecordedAt(recordedAt: unknown): string {
  const parsedTimestamp = clockTimestampSchema.safeParse(recordedAt);
  if (!parsedTimestamp.success) {
    throw new Lm1Error("store_corrupt", "Long-memory clock returned an invalid timestamp.");
  }
  try {
    return new Date(parsedTimestamp.data).toISOString();
  } catch {
    throw new Lm1Error("store_corrupt", "Long-memory clock returned an invalid timestamp.");
  }
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
      const parsedCaptureInput = parseCapturePreparedInput(captureInput);
      const sourceDigest = canonicalCaptureDigest(parsedCaptureInput.prepared);
      if (sourceDigest !== parsedCaptureInput.prepared.canonicalCaptureDigest) {
        throw new Lm1Error("evidence_binding_invalid", "Prepared capture digest mismatch.");
      }

      let binding: Awaited<ReturnType<EvidenceBindingPort["verify"]>>;
      try {
        binding = await input.evidenceBinding.verify({
          workspaceKey: parsedCaptureInput.prepared.workspaceKey,
          canonicalCaptureDigest: sourceDigest,
          evidenceIds: parsedCaptureInput.prepared.evidenceIds,
          authorization: parsedCaptureInput.authorization,
        });
      } catch (error) {
        mapPortError(error);
      }
      const evidenceDigests = assertBinding(parsedCaptureInput.prepared.evidenceIds, binding);

      let eligibility: Awaited<ReturnType<EvidenceEligibilityPort["resolve"]>>;
      try {
        eligibility = await input.evidenceEligibility.resolve({
          workspaceKey: parsedCaptureInput.prepared.workspaceKey,
          evidenceIds: parsedCaptureInput.prepared.evidenceIds,
        });
      } catch (error) {
        mapPortError(error);
      }
      assertEligibility(
        parsedCaptureInput.prepared.workspaceKey,
        parsedCaptureInput.prepared.evidenceIds,
        eligibility,
      );

      assertReferences(input.store, parsedCaptureInput.prepared);

      let recordedAt: string;
      try {
        recordedAt = input.clock.now();
      } catch (error) {
        mapClockError(error);
      }
      return input.store.publish(
        buildRecord(parsedCaptureInput.prepared, evidenceDigests, recordedAt),
      );
    },
  };
}
