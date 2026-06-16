import { describe, expect, it } from "vitest";
import {
  evidenceStatusSchema,
  retentionClassSchema,
  revocationReasonSchema,
  sourceKindSchema,
  transitionKindSchema,
} from "../src/enums.js";

describe("evidence-ledger enums", () => {
  it("sourceKind accepts the seven canonical kinds", () => {
    for (const k of ["file", "command", "grep", "fetch", "hook", "manual", "agent_request"]) {
      expect(sourceKindSchema.safeParse(k).success).toBe(true);
    }
    expect(sourceKindSchema.safeParse("socket").success).toBe(false);
  });

  it("retentionClass accepts the four classes", () => {
    for (const c of ["transient", "session", "pinned", "manual_hold"]) {
      expect(retentionClassSchema.safeParse(c).success).toBe(true);
    }
    expect(retentionClassSchema.safeParse("forever").success).toBe(false);
  });

  it("status accepts the three states", () => {
    for (const s of ["available", "retained_metadata_only", "revoked"]) {
      expect(evidenceStatusSchema.safeParse(s).success).toBe(true);
    }
    expect(evidenceStatusSchema.safeParse("deleted").success).toBe(false);
  });

  it("revocationReason is revoked-only and excludes retention_gc", () => {
    for (const r of ["secret_false_negative", "user_requested_purge", "policy_change"]) {
      expect(revocationReasonSchema.safeParse(r).success).toBe(true);
    }
    expect(revocationReasonSchema.safeParse("retention_gc").success).toBe(false);
  });

  it("transitionKind covers the lifecycle events", () => {
    for (const t of ["created", "pinned", "unpinned", "revoked", "raw_gc"]) {
      expect(transitionKindSchema.safeParse(t).success).toBe(true);
    }
    expect(transitionKindSchema.safeParse("approved").success).toBe(false);
  });
});
