// packages/output-filter/test/firewall-field.test.ts
import { describe, expect, it } from "vitest";
import { filterOutput } from "../src/index.js";

describe("filterOutput — firewall counts on the result", () => {
  it("reports redacted findings and observed emails", async () => {
    const raw = [
      "line with card 4111111111111111",
      "contact dev@example.com",
      `${"filler line to keep the pipeline in normal mode\n".repeat(20)}`,
    ].join("\n");
    const r = await filterOutput({
      raw,
      intent: "find the card",
      mode: "balanced",
      maxReturnedBytes: 4000,
    });
    expect(r.firewall).toEqual({
      findings: [{ name: "credit_card", count: 1 }],
      observed: [{ name: "email", count: 1 }],
    });
  });

  it("omits the field entirely on clean input", async () => {
    const r = await filterOutput({
      raw: "clean text\n".repeat(10),
      intent: "read",
      mode: "balanced",
      maxReturnedBytes: 4000,
    });
    expect(r.firewall).toBeUndefined();
  });
});
