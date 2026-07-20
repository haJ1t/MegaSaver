import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLm1CaptureService } from "../src/lm1-capture.js";
import { Lm1Error } from "../src/lm1-errors.js";
import { createLm1RecallService } from "../src/lm1-recall.js";
import { createFileLm1Store } from "../src/lm1-store.js";

const roots: string[] = [];
const workspaceKey = "0123456789abcdef";
const evidenceId = "11111111-1111-4111-8111-111111111111";
const secondEvidenceId = "22222222-2222-4222-8222-222222222222";

function createRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "megasaver-lm1-capture-")));
  roots.push(root);
  return root;
}

function createService(options?: {
  status?: "available" | "retained_metadata_only" | "revoked";
  unresolvedHighRisk?: boolean;
  evidenceIds?: readonly string[];
  binding?: readonly { evidenceId: string; evidenceDigest: string }[] | null;
  bindingError?: unknown;
  eligibility?: unknown;
  eligibilityError?: unknown;
  store?: ReturnType<typeof createFileLm1Store>;
  recordedAt?: string;
  clock?: { now(): string };
}) {
  const redact = vi.fn(({ text, action }: { text: string; action: string | null }) => ({
    text,
    action,
    unresolvedHighRisk: false,
  }));
  const store = options?.store ?? createFileLm1Store({ storeRoot: createRoot() });
  const service = createLm1CaptureService({
    store,
    redaction: { version: "redaction-v1", redact },
    evidenceBinding: {
      verify: async ({ evidenceIds }) => {
        if (options?.bindingError !== undefined) throw options.bindingError;
        return options?.binding === null
          ? null
          : {
              evidence:
                options?.binding ??
                evidenceIds.map((resolvedEvidenceId) => ({
                  evidenceId: resolvedEvidenceId,
                  evidenceDigest: "a".repeat(64),
                })),
            };
      },
    },
    evidenceEligibility: {
      resolve: async ({ workspaceKey: requestedWorkspaceKey, evidenceIds }) => {
        if (options?.eligibilityError !== undefined) throw options.eligibilityError;
        return (options !== undefined && "eligibility" in options
          ? options.eligibility
          : (options?.evidenceIds ?? evidenceIds).map((resolvedEvidenceId) => ({
              evidenceId: resolvedEvidenceId,
              workspaceKey: requestedWorkspaceKey,
              status: options?.status ?? "available",
              unresolvedHighRisk: options?.unresolvedHighRisk ?? false,
            }))) as unknown as {
          evidenceId: string;
          workspaceKey: string;
          status: "available" | "retained_metadata_only" | "revoked";
          unresolvedHighRisk: boolean;
        }[];
      },
    },
    clock: options?.clock ?? { now: () => options?.recordedAt ?? "2026-07-20T00:00:01.000Z" },
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

  it("adopts one recorded-at reservation across different-clock retries", async () => {
    const store = createFileLm1Store({ storeRoot: createRoot() });
    const first = createService({ store, recordedAt: "2026-07-20T00:00:01.000Z" }).service;
    const retry = createService({ store, recordedAt: "2026-07-20T00:01:00.000Z" }).service;
    const prepared = first.prepare(snapshotInput());

    await expect(
      first.capturePrepared({ prepared, authorization: "signed" }),
    ).resolves.toMatchObject({
      inserted: true,
      record: { recordedAt: "2026-07-20T00:00:01.000Z" },
    });
    await expect(
      retry.capturePrepared({ prepared, authorization: "signed" }),
    ).resolves.toMatchObject({
      inserted: false,
      record: { recordedAt: "2026-07-20T00:00:01.000Z" },
    });

    const recall = createLm1RecallService({
      store,
      evidenceEligibility: {
        resolve: async ({ evidenceIds, workspaceKey: requestedWorkspaceKey }) =>
          evidenceIds.map((resolvedEvidenceId) => ({
            evidenceId: resolvedEvidenceId,
            workspaceKey: requestedWorkspaceKey,
            status: "available" as const,
            unresolvedHighRisk: false,
          })),
      },
    });
    await expect(
      recall.recall({ workspaceKey, task: "billing status", tokenBudget: 100 }),
    ).resolves.toMatchObject({
      items: [{ value: "Billing status is paid." }],
    });
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

  it("normalizes hostile public capture request getters", async () => {
    const { service } = createService();

    await expect(
      service.capturePrepared(
        new Proxy(
          {},
          {
            get() {
              throw new Error("hostile capture request");
            },
          },
        ) as never,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
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

  it("rejects an out-of-order evidence binding", async () => {
    const { service } = createService({
      binding: [
        { evidenceId: secondEvidenceId, evidenceDigest: "a".repeat(64) },
        { evidenceId, evidenceDigest: "b".repeat(64) },
      ],
    });
    const prepared = service.prepare({
      ...snapshotInput(),
      evidenceIds: [secondEvidenceId, evidenceId],
    });

    await expect(
      service.capturePrepared({ prepared, authorization: "signed" }),
    ).rejects.toMatchObject({ code: "evidence_binding_invalid" });
  });

  it("maps a malformed evidence eligibility reply to a closed error", async () => {
    const { service } = createService({ eligibility: null });
    const prepared = service.prepare(snapshotInput());

    await expect(
      service.capturePrepared({ prepared, authorization: "signed" }),
    ).rejects.toMatchObject({ code: "store_corrupt" });
  });

  it("normalizes typed evidence-port failures to a closed error", async () => {
    const binding = createService({
      bindingError: new Lm1Error("invalid_transition", "adapter-controlled error"),
    }).service;
    const eligibility = createService({
      eligibilityError: new Lm1Error("write_failed", "adapter-controlled error"),
    }).service;
    const prepared = binding.prepare(snapshotInput());

    await expect(
      binding.capturePrepared({ prepared, authorization: "signed" }),
    ).rejects.toMatchObject({ code: "store_corrupt" });
    await expect(
      eligibility.capturePrepared({ prepared, authorization: "signed" }),
    ).rejects.toMatchObject({ code: "store_corrupt" });
  });

  it("normalizes evidence response getters to a closed error", async () => {
    const binding = createService({
      binding: new Proxy([], {
        get() {
          throw new Lm1Error("invalid_transition", "adapter-controlled error");
        },
      }) as unknown as readonly { evidenceId: string; evidenceDigest: string }[],
    }).service;
    const eligibility = createService({
      eligibility: new Proxy([], {
        get() {
          throw new Lm1Error("write_failed", "adapter-controlled error");
        },
      }),
    }).service;
    const prepared = binding.prepare(snapshotInput());

    await expect(
      binding.capturePrepared({ prepared, authorization: "signed" }),
    ).rejects.toMatchObject({ code: "store_corrupt" });
    await expect(
      eligibility.capturePrepared({ prepared, authorization: "signed" }),
    ).rejects.toMatchObject({ code: "store_corrupt" });
  });

  it("maps an invalid clock result to a typed closed error", async () => {
    const { service } = createService({ recordedAt: "not-a-date" });
    const prepared = service.prepare(snapshotInput());

    await expect(
      service.capturePrepared({ prepared, authorization: "signed" }),
    ).rejects.toMatchObject({ code: "store_corrupt" });
  });

  it("rejects a calendar-invalid clock timestamp", async () => {
    const { service } = createService({ recordedAt: "2026-02-30T00:00:01.000Z" });
    const prepared = service.prepare(snapshotInput());

    await expect(
      service.capturePrepared({ prepared, authorization: "signed" }),
    ).rejects.toMatchObject({ code: "store_corrupt" });
  });

  it("normalizes a typed clock failure to a closed error", async () => {
    const { service } = createService({
      clock: {
        now() {
          throw new Lm1Error("invalid_input", "clock-controlled error");
        },
      },
    });
    const prepared = service.prepare(snapshotInput());

    await expect(
      service.capturePrepared({ prepared, authorization: "signed" }),
    ).rejects.toMatchObject({ code: "store_corrupt" });
  });
});
