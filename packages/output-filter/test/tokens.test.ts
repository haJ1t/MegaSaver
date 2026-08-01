import { describe, expect, it } from "vitest";
import { MAX_SAFE_RUN, countTokens } from "../src/tokens.js";

describe("countTokens run-length guard", () => {
  it("counts normal text exactly — no chunking tax", async () => {
    // 56 KB of ordinary code: every run is short, so this must take the
    // whole-string path and match it exactly.
    const code = "export function handle(req, res) {\n  return res.json({ ok: true });\n}\n".repeat(
      800,
    );
    const { getEncoding } = await import("js-tiktoken");
    const exact = getEncoding("cl100k_base").encode(code).length;

    expect(await countTokens(code)).toBe(exact);
  });

  it("chunks only when an unbroken run exceeds the guard", async () => {
    const pathological = "X".repeat(MAX_SAFE_RUN * 4);
    const started = Date.now();
    const count = await countTokens(pathological);

    expect(count).toBeGreaterThan(0);
    // Whole-string encoding of this input takes tens of seconds; the guard must
    // keep it in the low seconds.
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("keeps the guard small enough to stay off the quadratic curve", () => {
    // Measured 2026-08-01: run 2,000 -> 142 ms, 8,000 -> 2,277 ms,
    // 32,000 -> 36 s. Doubling the run quadruples the time.
    expect(MAX_SAFE_RUN).toBeLessThanOrEqual(2000);
  });
});
