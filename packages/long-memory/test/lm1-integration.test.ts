import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLm1CaptureService } from "../src/lm1-capture.js";
import { Lm1Error } from "../src/lm1-errors.js";
import { deriveEvidenceBindingDigest } from "../src/lm1-identity.js";
import type { PreparedCapture } from "../src/lm1-model.js";
import { createFileLm1Store } from "../src/lm1-store.js";

const roots: string[] = [];
const workspaceKey = "0123456789abcdef";
const evidenceId = "11111111-1111-4111-8111-111111111111";
const rawPayload = "durable source bytes";
const returnedPayload = "redacted durable source bytes";

type DurableEvidence = {
  id: string;
  workspaceKey: string;
  rawPayload: string;
  returnedPayload: string;
  rawDigest: string;
  returnedDigest: string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm1-integration-")));
  roots.push(root);
  return root;
}

function durableEvidence(overrides?: Partial<DurableEvidence>): DurableEvidence {
  return {
    id: evidenceId,
    workspaceKey,
    rawPayload,
    returnedPayload,
    rawDigest: sha256(rawPayload),
    returnedDigest: sha256(returnedPayload),
    ...overrides,
  };
}

function createDurablePublicDataCoordinator(input: {
  storeRoot: string;
  ledger: Map<string, DurableEvidence>;
  materialize: () => DurableEvidence;
}) {
  const events: string[] = [];
  const store = createFileLm1Store({ storeRoot: input.storeRoot });
  const capture = createLm1CaptureService({
    store,
    redaction: {
      version: "redaction-v1",
      redact: ({ text, action }) => ({ text, action, unresolvedHighRisk: false }),
    },
    evidenceBinding: {
      verify: async ({
        authorization,
        canonicalCaptureDigest,
        evidenceIds,
        workspaceKey: requestedWorkspaceKey,
      }) => {
        events.push("binding");
        const authorizationDigest = `${requestedWorkspaceKey}:${evidenceIds.join(",")}:${canonicalCaptureDigest}`;
        if (authorization !== authorizationDigest) return null;
        const evidence = evidenceIds.map((requestedEvidenceId) =>
          input.ledger.get(requestedEvidenceId),
        );
        return evidence.some((entry) => entry === undefined)
          ? null
          : {
              evidence: evidence.map((entry, index) => ({
                evidenceId: evidenceIds[index] as string,
                evidenceDigest: (entry as DurableEvidence).returnedDigest,
              })),
            };
      },
    },
    evidenceEligibility: {
      resolve: async ({ evidenceIds, workspaceKey: requestedWorkspaceKey }) => {
        events.push("eligibility");
        return evidenceIds.map((requestedEvidenceId) => ({
          evidenceId: requestedEvidenceId,
          workspaceKey: requestedWorkspaceKey,
          status: input.ledger.has(requestedEvidenceId)
            ? ("available" as const)
            : ("revoked" as const),
          unresolvedHighRisk: false,
        }));
      },
    },
    clock: { now: () => "2026-07-20T00:00:01.000Z" },
  });

  function loadAndVerifyEvidence(): DurableEvidence {
    events.push("load");
    const existing = input.ledger.get(evidenceId);
    if (existing === undefined) {
      events.push("materialize");
      const materialized = input.materialize();
      input.ledger.set(materialized.id, materialized);
      return materialized;
    }
    if (
      existing.id !== evidenceId ||
      existing.workspaceKey !== workspaceKey ||
      sha256(existing.rawPayload) !== existing.rawDigest ||
      sha256(existing.returnedPayload) !== existing.returnedDigest
    ) {
      throw new Lm1Error("store_corrupt", "Durable public evidence does not match its commitment.");
    }
    events.push("verify");
    return existing;
  }

  return {
    events,
    store,
    async captureSnapshot(inputSnapshot: ReturnType<typeof snapshotInput>) {
      const prepared = capture.prepare(inputSnapshot);
      const evidence = loadAndVerifyEvidence();
      const authorization = `${workspaceKey}:${evidence.id}:${prepared.canonicalCaptureDigest}`;
      events.push("authorize");
      const published = await capture.capturePrepared({ prepared, authorization });
      return { prepared, published };
    },
  };
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
  it("load-verifies durable evidence before authorization and publishes one original LM1 record", async () => {
    const storeRoot = createRoot();
    const ledger = new Map([[evidenceId, durableEvidence()]]);
    const materialize = vi.fn(() => durableEvidence());
    const restarted = createDurablePublicDataCoordinator({ storeRoot, ledger, materialize });

    expect(restarted.store.list(workspaceKey, 10_000)).toEqual([]);

    const first = await restarted.captureSnapshot(snapshotInput());
    const retry = createDurablePublicDataCoordinator({ storeRoot, ledger, materialize });
    const second = await retry.captureSnapshot(snapshotInput());

    expect(materialize).not.toHaveBeenCalled();
    expect(restarted.events).toEqual(["load", "verify", "authorize", "binding", "eligibility"]);
    expect(retry.events).toEqual(["load", "verify", "authorize", "binding", "eligibility"]);
    expect(first.prepared).toEqual(second.prepared);
    expect(first.published).toMatchObject({ inserted: true });
    expect(second.published).toMatchObject({ inserted: false, record: first.published.record });
    expect(first.published.record.evidenceBindingDigest).toBe(
      deriveEvidenceBindingDigest({
        workspaceKey,
        canonicalCaptureDigest: (first.prepared as PreparedCapture).canonicalCaptureDigest,
        evidenceIds: [evidenceId],
        evidenceDigests: [sha256(returnedPayload)],
      }),
    );
  });

  it("rejects corrupted durable evidence before authorization, binding, or materialization", async () => {
    const ledger = new Map([
      [evidenceId, durableEvidence({ rawPayload: "corrupted durable source bytes" })],
    ]);
    const materialize = vi.fn(() => durableEvidence());
    const coordinator = createDurablePublicDataCoordinator({
      storeRoot: createRoot(),
      ledger,
      materialize,
    });

    await expect(coordinator.captureSnapshot(snapshotInput())).rejects.toMatchObject({
      code: "store_corrupt",
    });
    expect(coordinator.events).toEqual(["load"]);
    expect(materialize).not.toHaveBeenCalled();
  });
});
