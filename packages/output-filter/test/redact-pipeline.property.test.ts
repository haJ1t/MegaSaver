import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { filterOutput } from "../src/types.js";

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

const surfaceOf = (raw: string): string => {
  const result = filterOutput({ raw, mode: "safe" });
  return result.summary + result.excerpts.map((e) => e.text).join("\n");
};

describe("redact pipeline invariant (F-MED-1, spec §3.1/§11)", () => {
  it("no recognised secret survives filterOutput even amid noise", () => {
    fc.assert(
      fc.property(secretArb, fc.integer({ min: 0, max: 50 }), (secret, position) => {
        const noise = Array.from({ length: 60 }, (_, i) => `log line ${i}`);
        noise.splice(Math.min(position, noise.length), 0, `token=${secret}`);
        const surface = surfaceOf(noise.join("\n"));
        expect(surface).not.toContain(secret);
      }),
      { numRuns: 100 },
    );
  });
});
