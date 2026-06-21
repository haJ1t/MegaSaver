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

describe("filterOutput passthrough thresholds (Proxy Mode v1.2 §11)", () => {
  it("small output passes through without fake savings", () => {
    const result = filterOutput(base("small output line\n"));
    expect(result.decision).toBe("passthrough");
    expect(result.compressor).toBe("generic");
    expect(result.savingRatio).toBeGreaterThanOrEqual(0);
    expect(result.summary).toContain("passthrough");
  });

  it("mid-size output returns a light summary, not full compression", () => {
    const raw = `${"x".repeat(6_000)}\n`; // ~1500 tokens, between thresholds
    const result = filterOutput(base(raw));
    expect(result.decision).toBe("light");
  });

  it("large vitest output is fully compressed with the vitest compressor", () => {
    const failing = [
      " ❯ src/b.test.ts > adds numbers",
      "   × adds numbers",
      "     AssertionError: expected 3 to be 4",
      " Test Files  1 failed (1)",
      "      Tests  1 failed (1)",
      "   Duration  1.20s",
    ].join("\n");
    const passing = Array.from(
      { length: 1500 },
      (_, i) => ` ✓ src/a.test.ts > passes ${i} (1ms)`,
    ).join("\n");
    const raw = `${passing}\n${failing}\n`;
    const result = filterOutput(
      base(raw, {
        mode: "balanced",
        source: { kind: "command", command: "vitest", args: ["run"] },
      }),
    );
    expect(result.decision).toBe("compressed");
    expect(result.compressor).toBe("vitest");
    expect(result.classification.category).toBe("vitest");
    expect(result.savingRatio).toBeGreaterThan(0);
    expect(result.rawTokens).toBeGreaterThan(result.returnedTokens);
  });
});

describe("filterOutput engine-aware ranking (Proxy Mode v1.2 §8)", () => {
  const raw = `${Array.from({ length: 600 }, (_, i) => `plain log line ${i}`).join("\n")}\ncall useAuthToken now\n`;

  it("is off by default: no engine explanation on excerpts", () => {
    const result = filterOutput(base(raw, { sessionHints: { recentMemory: ["useAuthToken"] } }));
    expect(result.excerpts.every((e) => e.engine === undefined)).toBe(true);
  });

  it("when enabled, attaches a normalized engine explanation", () => {
    const result = filterOutput(
      base(raw, { engineRanking: true, sessionHints: { recentMemory: ["useAuthToken"] } }),
    );
    expect(result.excerpts.some((e) => e.engine !== undefined)).toBe(true);
    const memHit = result.excerpts.find((e) => e.text.includes("useAuthToken"));
    expect(memHit?.engine?.memoryBoost ?? 0).toBeGreaterThan(0);
    for (const e of result.excerpts) {
      if (e.engine === undefined) continue;
      expect(e.engine.finalScore).toBeGreaterThanOrEqual(0);
      expect(e.engine.finalScore).toBeLessThanOrEqual(1);
    }
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

describe("filterOutput no-blind floor (mission: never strip what the model needs)", () => {
  // grep-style output that trips the typescript classifier via a stray
  // "error TSxxxx:" token but carries no parseable tsc diagnostic, so the
  // specialized compressor empties it. The model must still get content.
  const grepLike = (): string => {
    const lines: string[] = [];
    for (let i = 0; i < 3000; i++) {
      lines.push(`packages/x/src/file${i}.ts:${i}:import { thing } from "./dep";`);
    }
    lines.push("readme: see error TS9999: legacy migration note");
    return lines.join("\n");
  };

  it("returns excerpts when a specialized compressor matches nothing", () => {
    const raw = grepLike();
    const result = filterOutput(base(raw, { mode: "aggressive" }));
    expect(result.decision).toBe("compressed");
    expect(result.classification.category).toBe("typescript");
    expect(result.excerpts.length).toBeGreaterThan(0);
  });

  it("returns real content, not just the summary line", () => {
    const result = filterOutput(base(grepLike(), { mode: "aggressive" }));
    const excerptBytes = result.excerpts.reduce((n, e) => n + Buffer.byteLength(e.text), 0);
    expect(excerptBytes).toBeGreaterThan(0);
    expect(result.returnedBytes).toBeGreaterThan(Buffer.byteLength(result.summary));
  });

  it("keeps a truncated top excerpt when every chunk exceeds the budget", () => {
    // one very long line per chunk: each 40-line chunk far exceeds the
    // 4000-byte aggressive budget, so the greedy fit keeps zero and the
    // floor must keep exactly one truncated top excerpt within budget.
    const huge = Array.from({ length: 200 }, (_, i) => `line ${i} ${"x".repeat(500)}`).join("\n");
    const result = filterOutput(base(huge, { mode: "aggressive" }));
    expect(result.decision).toBe("compressed");
    expect(result.excerpts).toHaveLength(1);
    expect(result.warnings).toContain(
      "specialized compression produced no excerpts; returned generic excerpt",
    );
    const excerptBytes = result.excerpts.reduce((n, e) => n + Buffer.byteLength(e.text), 0);
    expect(excerptBytes).toBeLessThanOrEqual(4000); // aggressive budget
  });
});
