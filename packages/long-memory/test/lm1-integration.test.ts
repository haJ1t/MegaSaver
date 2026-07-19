import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLm1CaptureService } from "../src/lm1-capture.js";
import { deriveEvidenceBindingDigest } from "../src/lm1-identity.js";
import { createFileLm1Store } from "../src/lm1-store.js";

const roots: string[] = [];
const workspaceKey = "0123456789abcdef";
const evidenceId = "11111111-1111-4111-8111-111111111111";
const evidenceDigest = "a".repeat(64);

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "megasaver-lm1-integration-"));
  roots.push(root);
  return root;
}

function createPublicDataCaptureService(
  storeRoot: string,
  publicEvidence: {
    load(evidenceId: string): string | undefined;
    has(evidenceId: string): boolean;
  },
) {
  const evidenceEligibility = {
    resolve: async ({
      workspaceKey: requestedWorkspaceKey,
      evidenceIds,
    }: { workspaceKey: string; evidenceIds: readonly string[] }) =>
      evidenceIds.map((requestedEvidenceId) => ({
        evidenceId: requestedEvidenceId,
        workspaceKey: requestedWorkspaceKey,
        status: publicEvidence.has(requestedEvidenceId)
          ? ("available" as const)
          : ("revoked" as const),
        unresolvedHighRisk: false,
      })),
  };
  return createLm1CaptureService({
    store: createFileLm1Store({ storeRoot }),
    redaction: {
      version: "redaction-v1",
      redact: ({ text, action }) => ({ text, action, unresolvedHighRisk: false }),
    },
    evidenceBinding: {
      verify: async ({ evidenceIds }) => {
        const evidence = evidenceIds.map((requestedEvidenceId) =>
          publicEvidence.load(requestedEvidenceId),
        );
        return evidence.some((digest) => digest === undefined)
          ? null
          : {
              evidence: evidenceIds.map((requestedEvidenceId, index) => ({
                evidenceId: requestedEvidenceId,
                evidenceDigest: evidence[index] as string,
              })),
            };
      },
    },
    evidenceEligibility,
    clock: { now: () => "2026-07-20T00:00:01.000Z" },
  });
}

function snapshotInput() {
  return {
    workspaceKey,
    kind: "state_snapshot" as const,
    observedAt: "2026-07-20T00:00:00.000Z",
    text: "Billing status is paid.",
    action: null,
    evidenceIds: [evidenceId],
    stateKey: "billing.status",
    representation: "value" as const,
    supersedesSnapshotId: null,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("LM1 public-data restart integration", () => {
  it("reconstructs and adopts an LM1 record from durable public evidence after an authorization-free retry", async () => {
    const storeRoot = createRoot();
    const rawEvidence = new Map([[evidenceId, evidenceDigest]]);
    const loadedEvidenceIds: string[] = [];
    const publicEvidence = {
      load(requestedEvidenceId: string) {
        loadedEvidenceIds.push(requestedEvidenceId);
        return rawEvidence.get(requestedEvidenceId);
      },
      has(requestedEvidenceId: string) {
        return rawEvidence.has(requestedEvidenceId);
      },
    };
    const restarted = createPublicDataCaptureService(storeRoot, publicEvidence);
    const reconstructed = restarted.prepare(snapshotInput());

    const materialized = await restarted.capturePrepared({
      prepared: reconstructed,
      authorization: "",
    });
    const retry = createPublicDataCaptureService(storeRoot, publicEvidence);
    const retryPrepared = retry.prepare(snapshotInput());

    expect(retryPrepared).toEqual(reconstructed);
    expect(materialized.inserted).toBe(true);

    await expect(
      retry.capturePrepared({ prepared: retryPrepared, authorization: "" }),
    ).resolves.toMatchObject({ inserted: false, record: materialized.record });
    expect(loadedEvidenceIds).toEqual([evidenceId, evidenceId]);
    expect(materialized.record.evidenceBindingDigest).toBe(
      deriveEvidenceBindingDigest({
        workspaceKey,
        canonicalCaptureDigest: reconstructed.canonicalCaptureDigest,
        evidenceIds: [evidenceId],
        evidenceDigests: [evidenceDigest],
      }),
    );
  });
});
