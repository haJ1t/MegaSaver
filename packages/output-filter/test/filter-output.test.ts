import { describe, expect, it } from "vitest";
import { OutputFilterError } from "../src/errors.js";
import { type FilterOutputInput, filterOutput, filterOutputInputSchema } from "../src/types.js";

const base = (raw: string, overrides: Partial<FilterOutputInput> = {}): FilterOutputInput => ({
  raw,
  mode: "balanced",
  ...overrides,
});

describe("filterOutput boundary validation (spec §5.1 / §8)", () => {
  it("rejects unknown keys via .strict()", () => {
    const parsed = filterOutputInputSchema.safeParse({
      raw: "x",
      mode: "balanced",
      bogus: 1,
    });
    expect(parsed.success).toBe(false);
  });

  it("throws OutputFilterError('validation_failed') on bad input", () => {
    expect(() => filterOutput({ raw: "x", mode: "nope" } as unknown as FilterOutputInput)).toThrow(
      OutputFilterError,
    );
  });
});

describe("filterOutput classification (Proxy Mode v1.2 §10)", () => {
  it("surfaces a typescript classification from a tsc command source", () => {
    const raw = "src/foo.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.";
    const result = filterOutput(
      base(raw, { source: { kind: "command", command: "tsc", args: ["--noEmit"] } }),
    );
    expect(result.classification.category).toBe("typescript");
    expect(result.classification.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("falls back to unknown for unrecognised output with no command", () => {
    const result = filterOutput(base("hello world\njust some log\n"));
    expect(result.classification.category).toBe("unknown");
  });
});

describe("filterOutput pipeline (spec §6 / §11)", () => {
  it("shrinks a large multi-KB blob (savingRatio > 0, within budget)", () => {
    const raw = Array.from({ length: 4000 }, (_, i) => `noise line ${i} lorem ipsum dolor`).join(
      "\n",
    );
    const result = filterOutput(base(raw, { mode: "aggressive" }));
    expect(result.savingRatio).toBeGreaterThan(0);
    expect(result.returnedBytes).toBeLessThanOrEqual(4_000);
    expect(result.rawBytes).toBe(Buffer.byteLength(raw));
    expect(result.bytesSaved).toBe(Math.max(0, result.rawBytes - result.returnedBytes));
  });

  it("ranks error lines ahead of noise in excerpts", () => {
    const lines: string[] = [];
    for (let i = 0; i < 200; i += 1) lines.push(`plain noise line ${i}`);
    lines.push("Error: critical failure in module X");
    const result = filterOutput(base(lines.join("\n"), { mode: "safe" }));
    const errIdx = result.excerpts.findIndex((e) => e.text.includes("Error: critical failure"));
    expect(errIdx).toBeGreaterThanOrEqual(0);
    const noiseIdx = result.excerpts.findIndex((e) => e.text.includes("plain noise"));
    if (noiseIdx >= 0) expect(errIdx).toBeLessThan(noiseIdx);
  });

  it("collapses repeated lines", () => {
    const raw = `${Array.from({ length: 20 }, () => "duplicate line").join("\n")}\nunique tail`;
    const result = filterOutput(base(raw, { mode: "safe" }));
    const joined = result.summary + result.excerpts.map((e) => e.text).join("\n");
    expect(joined).toContain("[repeated");
  });

  it("returns savingRatio 0 for empty raw", () => {
    const result = filterOutput(base("", { mode: "safe" }));
    expect(result.rawBytes).toBe(0);
    expect(result.savingRatio).toBe(0);
  });

  it("warns with the redaction count when secrets were removed", () => {
    const raw = "leak ghp_0123456789012345678901234567890123456789 here";
    const result = filterOutput(base(raw, { mode: "safe" }));
    expect(result.warnings?.some((w) => w.includes("redacted") && w.includes("1"))).toBe(true);
  });

  it("never sets chunkSetId (BB5 never persists)", () => {
    const result = filterOutput(base("hello", { mode: "safe" }));
    expect(result.chunkSetId).toBeUndefined();
  });
});
