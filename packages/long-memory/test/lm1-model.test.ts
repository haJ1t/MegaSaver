import { describe, expect, it, vi } from "vitest";
import {
  type RedactionPort,
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
});
