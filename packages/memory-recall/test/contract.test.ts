import { describe, expect, it } from "vitest";
import { contractSchema } from "../src/index.js";

const VALID = {
  name: "deploy-policy-recall",
  intent: "how do we deploy the api service",
  requiredEvidence: [{ kind: "memory-entry-ref", value: "00000000-0000-4000-8000-00000000000a" }],
  tokenBudget: 2000,
  createdFrom: null,
};

describe("contractSchema", () => {
  it("parses a valid contract", () => {
    expect(contractSchema.parse(VALID).name).toBe("deploy-policy-recall");
  });
  it("rejects a path-escaping name", () => {
    expect(contractSchema.safeParse({ ...VALID, name: "../evil" }).success).toBe(false);
  });
  it("rejects empty requiredEvidence", () => {
    expect(contractSchema.safeParse({ ...VALID, requiredEvidence: [] }).success).toBe(false);
  });
  it("rejects unknown keys (strict)", () => {
    expect(contractSchema.safeParse({ ...VALID, extra: 1 }).success).toBe(false);
  });
  it("rejects an intent above the LM2 task cap", () => {
    const oversize = "x".repeat(1_000_000);
    expect(contractSchema.safeParse({ ...VALID, intent: oversize }).success).toBe(false);
  });
});
