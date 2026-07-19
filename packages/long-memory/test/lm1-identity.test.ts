import { describe, expect, it } from "vitest";
import {
  canonicalCaptureDigest,
  deriveEvidenceBindingDigest,
  deriveLm1RecordId,
} from "../src/lm1-identity.js";

const prepared = {
  schemaVersion: 1,
  workspaceKey: "0123456789abcdef",
  kind: "state_snapshot" as const,
  observedAt: "2026-07-20T00:00:00.000Z",
  text: "Café paid",
  action: null,
  evidenceIds: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
  stateKey: "billing.status",
  representation: "value" as const,
  supersedesSnapshotId: null,
  redactionVersion: "redaction-v1",
};

describe("LM1 canonical identity", () => {
  it("uses the fixed capture digest and UUID vector", () => {
    const digest = canonicalCaptureDigest(prepared);

    expect(digest).toBe("6440cf9a61b685e192f2c651e04e371211434a86dc5b262907fc3be52cefb103");
    expect(deriveLm1RecordId(prepared.workspaceKey, prepared.kind, digest)).toBe(
      "6324c5c4-f73f-5cb9-9cf8-9e8d12399237",
    );
  });

  it("binds ordered evidence digests to the capture digest", () => {
    expect(
      deriveEvidenceBindingDigest({
        workspaceKey: prepared.workspaceKey,
        canonicalCaptureDigest: canonicalCaptureDigest(prepared),
        evidenceIds: prepared.evidenceIds,
        evidenceDigests: ["a".repeat(64), "b".repeat(64)],
      }),
    ).toBe("a120fe80b88240ff9fd398090b705d80f8720b469b2d7185360f78928d41bc13");
  });

  it("ignores persisted record fields when recomputing a capture digest", () => {
    expect(
      canonicalCaptureDigest({
        ...prepared,
        canonicalCaptureDigest: "f".repeat(64),
        id: "11111111-1111-4111-8111-111111111111",
        sourceDigest: "e".repeat(64),
        evidenceBindingDigest: "d".repeat(64),
        recordedAt: "2026-07-20T00:00:01.000Z",
        evidenceDigests: ["c".repeat(64), "b".repeat(64)],
        status: "recorded" as const,
      }),
    ).toBe(canonicalCaptureDigest(prepared));
  });
});
