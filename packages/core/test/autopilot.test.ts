import { describe, expect, it } from "vitest";
import { scoreCandidate } from "../src/autopilot.js";
import type { ExtractedCandidate } from "../src/session-memory.js";

function cand(over: Partial<ExtractedCandidate> = {}): ExtractedCandidate {
  return {
    type: "bug",
    source: "test_failure",
    scope: "session",
    confidence: "low",
    approval: "suggested",
    title: "run auth tests",
    content: "Failed step: run auth tests",
    relatedFiles: [],
    contentHash: "0123456789abcdef",
    dedupeKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:0123456789abcdef",
    occurrences: 1,
    ...over,
  };
}

describe("scoreCandidate", () => {
  it("recurring-failure: a cross-session recurring bug scores high", () => {
    expect(scoreCandidate(cand({ type: "bug" }), { priorSessionHit: true })).toBe("high");
  });

  it("recurring-failure: a cross-session recurring test_behavior scores high", () => {
    expect(
      scoreCandidate(cand({ type: "test_behavior", confidence: "medium" }), {
        priorSessionHit: true,
      }),
    ).toBe("high");
  });

  it("keep-extractor: non-failure types keep extractor confidence even on recurrence", () => {
    expect(scoreCandidate(cand({ type: "decision" }), { priorSessionHit: true })).toBe("low");
  });

  it("keep-extractor: no prior-session hit passes the extractor confidence through", () => {
    expect(scoreCandidate(cand({ confidence: "medium" }), { priorSessionHit: false })).toBe(
      "medium",
    );
    expect(scoreCandidate(cand({ confidence: "low" }), { priorSessionHit: false })).toBe("low");
  });

  it("keep-extractor clamps 'high': only the recurring-failure rule may return high", () => {
    // The auto-approval score must come from THIS function's recurrence rule,
    // never passed through from the extractor.
    const passedThrough = scoreCandidate(cand({ confidence: "high" }), { priorSessionHit: false });
    expect(passedThrough).toBe("medium");
    expect(passedThrough).not.toBe("high");
    // Same for a recurring non-failure type, which skips the recurring-failure rule.
    expect(
      scoreCandidate(cand({ type: "decision", confidence: "high" }), { priorSessionHit: true }),
    ).not.toBe("high");
  });

  it("M2 regression: a within-session retry storm NEVER scores high", () => {
    // 5 identical failures in ONE session (occurrences 5) with no cross-session
    // recurrence is a stuck automated loop, not an important memory.
    const storm = scoreCandidate(cand({ occurrences: 5 }), { priorSessionHit: false });
    expect(storm).toBe("low");
    expect(storm).not.toBe("high");
  });
});
