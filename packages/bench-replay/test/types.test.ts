import { describe, expect, it } from "vitest";
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
