import { agentIdSchema, riskLevelSchema } from "@megasaver/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sessionSchema, sessionUpdatePatchSchema } from "../src/session.js";

// Valid fixed base values for IDs and timestamps.
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const STARTED_AT = "2026-05-09T00:00:00.000Z";

const agentIds = agentIdSchema.options;
const riskLevels = riskLevelSchema.options;

// Arbitrary for a valid non-empty, non-control-char title string.
const validTitleArb = fc.string({ minLength: 1, maxLength: 80 }).filter(
  (s) =>
    s.trim().length > 0 &&
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — mirrors titleSchema
    /^[^\x00-\x1f\x7f-\x9f]+$/.test(s),
);

// Arbitrary for a valid base session object (all required fields).
const baseSessionArb = fc.record({
  id: fc.constant(SESSION_ID),
  projectId: fc.constant(PROJECT_ID),
  agentId: fc.constantFrom(...agentIds),
  riskLevel: fc.constantFrom(...riskLevels),
  title: fc.oneof(fc.constant(null), validTitleArb),
  startedAt: fc.constant(STARTED_AT),
  endedAt: fc.constant(null),
});

// Arbitrary for a valid patch (at least one field present).
const validPatchArb = fc
  .record(
    {
      title: fc.oneof(fc.constant(null), validTitleArb),
      riskLevel: fc.constantFrom(...riskLevels),
      agentId: fc.constantFrom(...agentIds),
    },
    { requiredKeys: [] },
  )
  .filter((p) => Object.keys(p).length > 0);

describe("sessionSchema — property test (V3)", () => {
  it("merged session (base + patch) always parses when both are valid", () => {
    fc.assert(
      fc.property(baseSessionArb, validPatchArb, (base, patch) => {
        const merged = { ...base, ...patch };
        const result = sessionSchema.safeParse(merged);
        expect(result.success).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it("sessionUpdatePatchSchema accepts any single-field valid patch", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.record({ title: fc.oneof(fc.constant(null), validTitleArb) }),
          fc.record({ riskLevel: fc.constantFrom(...riskLevels) }),
          fc.record({ agentId: fc.constantFrom(...agentIds) }),
        ),
        (patch) => {
          const result = sessionUpdatePatchSchema.safeParse(patch);
          expect(result.success).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("sessionUpdatePatchSchema rejects empty patch", () => {
    const result = sessionUpdatePatchSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
