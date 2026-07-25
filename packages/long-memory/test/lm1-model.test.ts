import { describe, expect, it, vi } from "vitest";
import { Lm1Error } from "../src/lm1-errors.js";
import {
  type RedactionPort,
  lm1RecordSchema,
  prepareCapture,
  prepareCaptureInputSchema,
  preparedCaptureSchema,
} from "../src/lm1-model.js";

const workspaceKey = "0123456789abcdef";
const firstEvidenceId = "11111111-1111-4111-8111-111111111111";
const secondEvidenceId = "22222222-2222-4222-8222-222222222222";

describe("LM1 capture model", () => {
  it("redacts a snapshot exactly once and seals sorted evidence", () => {
    const redact = vi.fn(({ text, action }: { text: string; action: string | null }) => ({
      text: `safe:${text}`,
      action,
      unresolvedHighRisk: false,
    }));
    const redactor: RedactionPort = { version: "redaction-v1", redact };

    const prepared = prepareCapture(
      {
        workspaceKey,
        kind: "state_snapshot",
        observedAt: "2026-07-20T00:00:00.000Z",
        text: " billing paid ",
        action: null,
        evidenceIds: [secondEvidenceId, firstEvidenceId, secondEvidenceId],
        stateKey: "billing.status",
        representation: "value",
        supersedesSnapshotId: null,
      },
      redactor,
    );

    expect(redact).toHaveBeenCalledOnce();
    expect(prepared.text).toBe("safe: billing paid");
    expect(prepared.action).toBeNull();
    expect(prepared.evidenceIds).toEqual([firstEvidenceId, secondEvidenceId]);
    expect(prepared.redactionVersion).toBe("redaction-v1");
    expect(preparedCaptureSchema.parse(prepared)).toEqual(prepared);
  });

  it("rejects unresolved redaction and unknown prepared fields", () => {
    const redactor: RedactionPort = {
      version: "redaction-v1",
      redact: ({ text, action }) => ({ text, action, unresolvedHighRisk: true }),
    };
    const input = {
      workspaceKey,
      kind: "state_snapshot" as const,
      observedAt: "2026-07-20T00:00:00.000Z",
      text: "billing paid",
      action: null,
      evidenceIds: [firstEvidenceId],
      stateKey: "billing.status",
      representation: "value" as const,
      supersedesSnapshotId: null,
    };

    expect(() => prepareCapture(input, redactor)).toThrow();
    expect(() => prepareCaptureInputSchema.parse({ ...input, unknown: true })).toThrow();
  });

  it("normalizes hostile public capture-input getters", () => {
    const redactor: RedactionPort = {
      version: "redaction-v1",
      redact: ({ text, action }) => ({ text, action, unresolvedHighRisk: false }),
    };

    expect(() =>
      prepareCapture(
        new Proxy(
          {},
          {
            get() {
              throw new Error("hostile capture input");
            },
          },
        ) as never,
        redactor,
      ),
    ).toThrow(expect.objectContaining({ code: "invalid_input" }));
  });

  it("rejects a calendar-invalid public capture timestamp", () => {
    expect(() =>
      prepareCapture(
        {
          workspaceKey,
          kind: "state_snapshot",
          observedAt: "2026-02-99T00:00:00.000Z",
          text: "billing paid",
          action: null,
          evidenceIds: [firstEvidenceId],
          stateKey: "billing.status",
          representation: "value",
          supersedesSnapshotId: null,
        },
        {
          version: "redaction-v1",
          redact: ({ text, action }) => ({ text, action, unresolvedHighRisk: false }),
        },
      ),
    ).toThrow(expect.objectContaining({ code: "invalid_input" }));
  });

  it("maps a redaction-adapter failure to a typed closed error", () => {
    const input = {
      workspaceKey,
      kind: "state_snapshot" as const,
      observedAt: "2026-07-20T00:00:00.000Z",
      text: "billing paid",
      action: null,
      evidenceIds: [firstEvidenceId],
      stateKey: "billing.status",
      representation: "value" as const,
      supersedesSnapshotId: null,
    };

    expect(() =>
      prepareCapture(input, {
        version: "redaction-v1",
        redact: () => {
          throw new Error("adapter boom");
        },
      }),
    ).toThrow(expect.objectContaining({ code: "store_corrupt" }));
  });

  it("normalizes typed redactor and version failures to a closed error", () => {
    const input = {
      workspaceKey,
      kind: "state_snapshot" as const,
      observedAt: "2026-07-20T00:00:00.000Z",
      text: "billing paid",
      action: null,
      evidenceIds: [firstEvidenceId],
      stateKey: "billing.status",
      representation: "value" as const,
      supersedesSnapshotId: null,
    };

    expect(() =>
      prepareCapture(input, {
        version: "redaction-v1",
        redact: () => {
          throw new Lm1Error("invalid_input", "adapter-controlled error");
        },
      }),
    ).toThrow(expect.objectContaining({ code: "store_corrupt" }));
    expect(() =>
      prepareCapture(input, {
        get version() {
          throw new Lm1Error("invalid_input", "adapter-controlled error");
        },
        redact: ({ text, action }) => ({ text, action, unresolvedHighRisk: false }),
      }),
    ).toThrow(expect.objectContaining({ code: "store_corrupt" }));
  });

  it("classifies malformed redacted capture fields and response getters as adapter corruption", () => {
    const input = {
      workspaceKey,
      kind: "state_snapshot" as const,
      observedAt: "2026-07-20T00:00:00.000Z",
      text: "billing paid",
      action: null,
      evidenceIds: [firstEvidenceId],
      stateKey: "billing.status",
      representation: "value" as const,
      supersedesSnapshotId: null,
    };

    expect(() =>
      prepareCapture(input, {
        version: "redaction-v1",
        redact: () => ({ text: "", action: null, unresolvedHighRisk: false }),
      }),
    ).toThrow(expect.objectContaining({ code: "store_corrupt" }));
    expect(() =>
      prepareCapture(input, {
        version: "redaction-v1",
        redact: () =>
          new Proxy(
            {},
            {
              get() {
                throw new Lm1Error("invalid_input", "adapter-controlled error");
              },
            },
          ) as never,
      }),
    ).toThrow(expect.objectContaining({ code: "store_corrupt" }));
  });

  it("requires a lowercase workspace and lowercase evidence UUIDs", () => {
    expect(() =>
      prepareCaptureInputSchema.parse({
        workspaceKey: "0123456789ABCDEF",
        kind: "state_snapshot",
        observedAt: "2026-07-20T00:00:00.000Z",
        text: "billing paid",
        action: null,
        evidenceIds: [firstEvidenceId.toUpperCase()],
        stateKey: "billing.status",
        representation: "value",
        supersedesSnapshotId: null,
      }),
    ).toThrow();
  });

  it("rejects a direct record with noncanonical capture fields", () => {
    const prepared = prepareCapture(
      {
        workspaceKey,
        kind: "state_snapshot",
        observedAt: "2026-07-20T00:00:00.000Z",
        text: "billing paid",
        action: null,
        evidenceIds: [firstEvidenceId, secondEvidenceId],
        stateKey: "billing.status",
        representation: "value",
        supersedesSnapshotId: null,
      },
      {
        version: "redaction-v1",
        redact: ({ text, action }) => ({ text, action, unresolvedHighRisk: false }),
      },
    );
    const record = {
      ...prepared,
      id: "33333333-3333-4333-8333-333333333333",
      sourceDigest: "a".repeat(64),
      evidenceBindingDigest: "b".repeat(64),
      recordedAt: "2026-07-20T00:00:01.000Z",
      evidenceDigests: ["c".repeat(64), "d".repeat(64)],
      status: "recorded" as const,
    };

    expect(
      lm1RecordSchema.safeParse({
        ...record,
        evidenceIds: [secondEvidenceId, firstEvidenceId],
      }).success,
    ).toBe(false);
    expect(lm1RecordSchema.safeParse({ ...record, text: " billing paid " }).success).toBe(false);
  });
});
