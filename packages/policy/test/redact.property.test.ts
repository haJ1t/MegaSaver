import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { redact } from "../src/redact.js";

const alnum = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const githubTokenArb = fc
  .string({ minLength: 36, maxLength: 60, unit: fc.constantFrom(...alnum.split("")) })
  .map((s) => `ghp_${s}`);

const openaiKeyArb = fc
  .string({ minLength: 20, maxLength: 50, unit: fc.constantFrom(...alnum.split("")) })
  .map((s) => `sk-${s}`);

const awsAccessKeyArb = fc
  .string({
    minLength: 16,
    maxLength: 16,
    unit: fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")),
  })
  .map((s) => `AKIA${s}`);

const secretArb = fc.oneof(githubTokenArb, openaiKeyArb, awsAccessKeyArb);

describe("redact — property (spec §5/§8.5)", () => {
  it("no recognised secret survives redaction", () => {
    fc.assert(
      fc.property(secretArb, (secret) => {
        const result = redact(`leak: ${secret}`);
        expect(result.count).toBeGreaterThanOrEqual(1);
        expect(result.redacted).not.toContain(secret);
      }),
      { numRuns: 100 },
    );
  });
});
