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

function assertBinding(
  evidenceIds: readonly string[],
  binding: { evidenceDigests: readonly string[] } | null,
): readonly string[] {
  if (binding === null || binding.evidenceDigests.length !== evidenceIds.length) {
    throw new Lm1Error("evidence_binding_invalid", "Evidence binding is incomplete.");
  }
  if (binding.evidenceDigests.some((digest) => !/^[0-9a-f]{64}$/.test(digest))) {
    throw new Lm1Error("evidence_binding_invalid", "Evidence binding contains an invalid digest.");
  }
  return binding.evidenceDigests;
}

function assertEligibility(
  workspaceKey: string,
  evidenceIds: readonly string[],
  eligibility: readonly {
    evidenceId: string;
    workspaceKey: string;
    status: "available" | "retained_metadata_only" | "revoked";
    unresolvedHighRisk: boolean;
  }[],
): void {
  if (eligibility.length !== evidenceIds.length) {
    throw new Lm1Error("evidence_unavailable", "Evidence eligibility is incomplete.");
  }
  for (const [index, evidence] of eligibility.entries()) {
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

      let binding: { evidenceDigests: readonly string[] } | null;
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

      return input.store.publish(buildRecord(prepared.data, evidenceDigests, input.clock.now()));
    },
  };
}
