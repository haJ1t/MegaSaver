import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";
import { recordedRequestSchema } from "../src/types.js";

describe("recordedRequestSchema", () => {
  it("accepts a minimal recorded /v1/messages body", () => {
    const parsed = recordedRequestSchema.safeParse({
      model: "claude-opus-4-8",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts tool_result blocks inside message content", () => {
    const parsed = recordedRequestSchema.safeParse({
      model: "claude-opus-4-8",
      messages: [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "big output" }],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a body with no messages array", () => {
    expect(recordedRequestSchema.safeParse({ model: "x" }).success).toBe(false);
  });
});

describe("child-spec #2 public surface", () => {
  it("exports the probe, budget, and journal entry points", () => {
    expect(typeof api.runIsolationProbe).toBe("function");
    expect(typeof api.estimateGateRunBudget).toBe("function");
    expect(typeof api.pendingRunIndices).toBe("function");
    expect(api.PROBE_SLOTS.pos).toBe(90);
    expect(api.SAFETY_FACTOR).toBe(1.3);
    expect(api.RESUME_SLOT_BASE).toBe(200);
  });
});
