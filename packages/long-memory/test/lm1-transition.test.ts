import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLm1CaptureService } from "../src/lm1-capture.js";
import { selectStructuralSnapshotLeaves } from "../src/lm1-state.js";
import { createFileLm1Store } from "../src/lm1-store.js";

const roots: string[] = [];
const workspaceKey = "0123456789abcdef";
const evidenceId = "11111111-1111-4111-8111-111111111111";

function createService() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm1-transition-")));
  roots.push(root);
  return createLm1CaptureService({
    store: createFileLm1Store({ storeRoot: root }),
    redaction: {
      version: "redaction-v1",
      redact: ({ text, action }) => ({ text, action, unresolvedHighRisk: false }),
    },
    evidenceBinding: {
      verify: async ({ evidenceIds }) => ({
        evidence: evidenceIds.map((evidenceId) => ({ evidenceId, evidenceDigest: "a".repeat(64) })),
      }),
    },
    evidenceEligibility: {
      resolve: async ({ workspaceKey: requestedWorkspaceKey, evidenceIds }) =>
        evidenceIds.map((resolvedEvidenceId) => ({
          evidenceId: resolvedEvidenceId,
          workspaceKey: requestedWorkspaceKey,
          status: "available" as const,
          unresolvedHighRisk: false,
        })),
    },
    clock: { now: () => "2026-07-20T00:00:03.000Z" },
  });
}

function snapshotInput(overrides?: Record<string, unknown>) {
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
    ...overrides,
  };
}

async function captureSnapshot(
  service: ReturnType<typeof createService>,
  overrides?: Record<string, unknown>,
) {
  const prepared = service.prepare(snapshotInput(overrides) as ReturnType<typeof snapshotInput>);
  return (await service.capturePrepared({ prepared, authorization: "signed" })).record;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("LM1 transitions and correction chains", () => {
  it("requires same-workspace, same-state-key, chronological snapshot endpoints", async () => {
    const service = createService();
    const pre = await captureSnapshot(service);
    const post = await captureSnapshot(service, {
      observedAt: "2026-07-20T00:00:02.000Z",
      text: "Billing status is pending.",
    });
    const prepared = service.prepare({
      workspaceKey,
      kind: "state_transition",
      observedAt: "2026-07-20T00:00:01.000Z",
      text: "Billing state changed.",
      action: "set pending",
      evidenceIds: [evidenceId],
      preSnapshotId: pre.id,
      postSnapshotId: post.id,
      outcome: "applied",
    });

    await expect(
      service.capturePrepared({ prepared, authorization: "signed" }),
    ).resolves.toMatchObject({
      record: { kind: "state_transition", preSnapshotId: pre.id, postSnapshotId: post.id },
    });

    const invalidPrepared = service.prepare({
      workspaceKey,
      kind: "state_transition",
      observedAt: "2026-07-20T00:00:01.000Z",
      text: "Billing state changed.",
      action: "set pending",
      evidenceIds: [evidenceId],
      preSnapshotId: post.id,
      postSnapshotId: pre.id,
      outcome: "applied",
    });
    await expect(
      service.capturePrepared({ prepared: invalidPrepared, authorization: "signed" }),
    ).rejects.toMatchObject({
      code: "invalid_transition",
    });
  });

  it("closes a superseded snapshot structurally even when the successor later becomes ineligible", async () => {
    const service = createService();
    const first = await captureSnapshot(service);
    const correction = await captureSnapshot(service, {
      observedAt: "2026-07-20T00:00:01.000Z",
      text: "Billing status is pending.",
      supersedesSnapshotId: first.id,
    });

    expect(selectStructuralSnapshotLeaves([first, correction])).toEqual([correction]);
    await expect(
      service.capturePrepared({
        prepared: service.prepare(
          snapshotInput({ observedAt: "2026-07-20T00:00:00.000Z", supersedesSnapshotId: first.id }),
        ),
        authorization: "signed",
      }),
    ).rejects.toMatchObject({ code: "invalid_transition" });
  });
});
