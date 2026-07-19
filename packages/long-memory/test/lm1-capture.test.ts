import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLm1CaptureService } from "../src/lm1-capture.js";
import { createFileLm1Store } from "../src/lm1-store.js";

const roots: string[] = [];
const workspaceKey = "0123456789abcdef";
const evidenceId = "11111111-1111-4111-8111-111111111111";

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "megasaver-lm1-capture-"));
  roots.push(root);
  return root;
}

function createService(options?: {
  status?: "available" | "retained_metadata_only" | "revoked";
  unresolvedHighRisk?: boolean;
  evidenceIds?: readonly string[];
  evidenceDigests?: readonly string[] | null;
}) {
  const redact = vi.fn(({ text, action }: { text: string; action: string | null }) => ({
    text,
    action,
    unresolvedHighRisk: false,
  }));
  const store = createFileLm1Store({ storeRoot: createRoot() });
  const service = createLm1CaptureService({
    store,
    redaction: { version: "redaction-v1", redact },
    evidenceBinding: {
      verify: async ({ evidenceIds }) =>
        options?.evidenceDigests === null
          ? null
          : { evidenceDigests: options?.evidenceDigests ?? evidenceIds.map(() => "a".repeat(64)) },
    },
    evidenceEligibility: {
      resolve: async ({ workspaceKey: requestedWorkspaceKey, evidenceIds }) =>
        (options?.evidenceIds ?? evidenceIds).map((resolvedEvidenceId) => ({
          evidenceId: resolvedEvidenceId,
          workspaceKey: requestedWorkspaceKey,
          status: options?.status ?? "available",
          unresolvedHighRisk: options?.unresolvedHighRisk ?? false,
        })),
    },
    clock: { now: () => "2026-07-20T00:00:01.000Z" },
  });
  return { redact, service };
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

describe("LM1 capture service", () => {
  it("captures a prepared snapshot after binding and exact eligibility checks", async () => {
    const { redact, service } = createService();
    const prepared = service.prepare(snapshotInput());

    await expect(
      service.capturePrepared({ prepared, authorization: "signed" }),
    ).resolves.toMatchObject({
      inserted: true,
      record: {
        kind: "state_snapshot",
        workspaceKey,
        recordedAt: "2026-07-20T00:00:01.000Z",
      },
    });
    expect(redact).toHaveBeenCalledOnce();
  });

  it("rejects a prepared payload whose digest no longer matches", async () => {
    const { service } = createService();
    const prepared = service.prepare(snapshotInput());

    await expect(
      service.capturePrepared({
        prepared: { ...prepared, text: "Billing status is pending." },
        authorization: "signed",
      }),
    ).rejects.toMatchObject({ code: "evidence_binding_invalid" });
  });

  it("rejects unavailable and non-exact evidence responses", async () => {
    const unavailable = createService({ status: "revoked" }).service;
    const duplicate = createService({ evidenceIds: [evidenceId, evidenceId] }).service;
    const prepared = unavailable.prepare(snapshotInput());

    await expect(
      unavailable.capturePrepared({ prepared, authorization: "signed" }),
    ).rejects.toMatchObject({
      code: "evidence_unavailable",
    });
    await expect(
      duplicate.capturePrepared({ prepared, authorization: "signed" }),
    ).rejects.toMatchObject({
      code: "evidence_unavailable",
    });
  });
});
