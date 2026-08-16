import { describe, expect, it } from "vitest";
import {
  type FailedAttempt,
  failedAttemptPatchSchema,
  seedFailureEvidence,
} from "../src/failed-attempt.js";
import { failureToRuleInputSchema, projectRuleSchema } from "../src/project-rule.js";

describe("failedAttemptPatchSchema", () => {
  it("accepts the closed mutable set", () => {
    expect(failedAttemptPatchSchema.parse({ convertedToRule: true }).convertedToRule).toBe(true);
    expect(failedAttemptPatchSchema.parse({ resolution: "use <=" }).resolution).toBe("use <=");
  });
  it("rejects unknown keys (strict)", () => {
    expect(() => failedAttemptPatchSchema.parse({ task: "x" })).toThrow();
  });
});

describe("failureToRuleInputSchema", () => {
  it("requires title/rule/severity, allows optional confidence/appliesTo/evidence", () => {
    const parsed = failureToRuleInputSchema.parse({ title: "t", rule: "r", severity: "warning" });
    expect(parsed.severity).toBe("warning");
  });
  it("rejects an unknown key and a missing severity", () => {
    expect(() =>
      failureToRuleInputSchema.parse({ title: "t", rule: "r", severity: "warning", id: "x" }),
    ).toThrow();
    expect(() => failureToRuleInputSchema.parse({ title: "t", rule: "r" })).toThrow();
  });
});

describe("seedFailureEvidence", () => {
  it("produces a deterministic evidence line", () => {
    const f = {
      id: "a0000000-0000-4000-8000-000000000001",
      createdAt: "2026-06-12T00:00:00.000Z",
      failedStep: "run auth tests",
      errorOutput: "401",
    } as FailedAttempt;
    expect(seedFailureEvidence(f)).toBe(
      "Derived from failed attempt a0000000-0000-4000-8000-000000000001 (2026-06-12T00:00:00.000Z): run auth tests — 401",
    );
  });
  it("falls back when errorOutput is absent", () => {
    const f = {
      id: "a0000000-0000-4000-8000-000000000001",
      createdAt: "2026-06-12T00:00:00.000Z",
      failedStep: "step",
    } as FailedAttempt;
    expect(seedFailureEvidence(f)).toContain("no error output");
  });
});

describe("projectRuleSchema additive TTL fields", () => {
  it("legacy rule row without expiresAt/verification still parses (additive)", () => {
    const legacy = {
      id: "c0000000-0000-4000-8000-000000000009",
      projectId: "11111111-1111-4111-8111-111111111111",
      title: "t",
      rule: "r",
      appliesTo: [],
      evidence: [],
      severity: "info",
      confidence: "medium",
      createdFrom: "manual",
      createdAt: "2026-06-12T00:00:00.000Z",
      updatedAt: "2026-06-12T00:00:00.000Z",
    };
    const parsed = projectRuleSchema.parse(legacy);
    expect(parsed.expiresAt).toBeUndefined();
    expect(parsed.verification).toBeUndefined();
  });

  it("projectRuleSchema accepts additive expiresAt + verification", () => {
    const parsed = projectRuleSchema.parse({
      id: "c0000000-0000-4000-8000-000000000010",
      projectId: "11111111-1111-4111-8111-111111111111",
      title: "t",
      rule: "r",
      appliesTo: [],
      evidence: [],
      severity: "info",
      confidence: "low",
      createdFrom: "failed_attempt",
      createdAt: "2026-06-12T00:00:00.000Z",
      updatedAt: "2026-06-12T00:00:00.000Z",
      expiresAt: "2026-09-10T00:00:00.000Z",
      verification: {
        outcome: "unverified",
        reasons: ["zero_evidence_pointers"],
        verifiedAt: "2026-06-12T00:00:00.000Z",
      },
    });
    expect(parsed.verification?.outcome).toBe("unverified");
  });
});
