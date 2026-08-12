import { describe, expect, it } from "vitest";
import { answerPayloadSchema } from "../src/qa.js";

describe("qa contract", () => {
  it("known:false without text is valid, known:true needs text", () => {
    expect(
      answerPayloadSchema.safeParse({
        askId: "1",
        known: false,
        text: "",
        confidence: "high",
        provenance: { liveSessionId: "b1", evidence: { kind: "none" }, answeredAtMs: Date.now() },
      }).success,
    ).toBe(true);
    expect(
      answerPayloadSchema.safeParse({
        askId: "1",
        known: true,
        text: "",
        confidence: "high",
        provenance: { liveSessionId: "b1", evidence: { kind: "none" }, answeredAtMs: Date.now() },
      }).success,
    ).toBe(false);
  });
});
