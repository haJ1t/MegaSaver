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

  it("throws OutputFilterError('validation_failed') on bad input", async () => {
    await expect(
      filterOutput({ raw: "x", mode: "nope" } as unknown as FilterOutputInput),
    ).rejects.toThrow(OutputFilterError);
  });
});

describe("filterOutput classification (Proxy Mode v1.2 §10)", () => {
  it("surfaces a typescript classification from a tsc command source", async () => {
    const raw = "src/foo.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.";
    const result = await filterOutput(
      base(raw, { source: { kind: "command", command: "tsc", args: ["--noEmit"] } }),
    );
    expect(result.classification.category).toBe("typescript");
    expect(result.classification.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("falls back to unknown for unrecognised output with no command", async () => {
    const result = await filterOutput(base("hello world\njust some log\n"));
    expect(result.classification.category).toBe("unknown");
  });
});

describe("filterOutput passthrough thresholds (Proxy Mode v1.2 §11)", () => {
  it("small output passes through without fake savings", async () => {
    const result = await filterOutput(base("small output line\n"));
    expect(result.decision).toBe("passthrough");
    expect(result.compressor).toBe("generic");
    expect(result.savingRatio).toBeGreaterThanOrEqual(0);
    expect(result.summary).toContain("passthrough");
  });

  it("mid-size output returns a light summary, not full compression", async () => {
    const raw = `${"x".repeat(6_000)}\n`; // ~1500 tokens, between thresholds
    const result = await filterOutput(base(raw));
    expect(result.decision).toBe("light");
  });

  it("large vitest output is fully compressed with the vitest compressor", async () => {
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
    const result = await filterOutput(
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

  it("is off by default: no engine explanation on excerpts", async () => {
    const result = await filterOutput(
      base(raw, { sessionHints: { recentMemory: ["useAuthToken"] } }),
    );
    expect(result.excerpts.every((e) => e.engine === undefined)).toBe(true);
  });

  it("when enabled, attaches a normalized engine explanation", async () => {
    const result = await filterOutput(
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
  it("shrinks a large multi-KB blob (savingRatio > 0, within budget)", async () => {
    const raw = Array.from({ length: 4000 }, (_, i) => `noise line ${i} lorem ipsum dolor`).join(
      "\n",
    );
    const result = await filterOutput(base(raw, { mode: "aggressive" }));
    expect(result.savingRatio).toBeGreaterThan(0);
    expect(result.returnedBytes).toBeLessThanOrEqual(4_000);
    expect(result.rawBytes).toBe(Buffer.byteLength(raw));
    expect(result.bytesSaved).toBe(Math.max(0, result.rawBytes - result.returnedBytes));
  });

  it("ranks error lines ahead of noise in excerpts", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 200; i += 1) lines.push(`plain noise line ${i}`);
    lines.push("Error: critical failure in module X");
    const result = await filterOutput(base(lines.join("\n"), { mode: "safe" }));
    const errIdx = result.excerpts.findIndex((e) => e.text.includes("Error: critical failure"));
    expect(errIdx).toBeGreaterThanOrEqual(0);
    const noiseIdx = result.excerpts.findIndex((e) => e.text.includes("plain noise"));
    if (noiseIdx >= 0) expect(errIdx).toBeLessThan(noiseIdx);
  });

  it("collapses repeated lines", async () => {
    const raw = `${Array.from({ length: 20 }, () => "duplicate line").join("\n")}\nunique tail`;
    const result = await filterOutput(base(raw, { mode: "safe" }));
    const joined = result.summary + result.excerpts.map((e) => e.text).join("\n");
    expect(joined).toContain("[repeated");
  });

  it("returns savingRatio 0 for empty raw", async () => {
    const result = await filterOutput(base("", { mode: "safe" }));
    expect(result.rawBytes).toBe(0);
    expect(result.savingRatio).toBe(0);
  });

  it("warns with the redaction count when secrets were removed", async () => {
    const raw = "leak ghp_0123456789012345678901234567890123456789 here";
    const result = await filterOutput(base(raw, { mode: "safe" }));
    expect(result.warnings?.some((w) => w.includes("redacted") && w.includes("1"))).toBe(true);
  });

  it("never sets chunkSetId (BB5 never persists)", async () => {
    const result = await filterOutput(base("hello", { mode: "safe" }));
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

  it("returns excerpts when a specialized compressor matches nothing", async () => {
    const raw = grepLike();
    const result = await filterOutput(base(raw, { mode: "aggressive" }));
    expect(result.decision).toBe("compressed");
    expect(result.classification.category).toBe("typescript");
    expect(result.excerpts.length).toBeGreaterThan(0);
  });

  it("returns real content, not just the summary line", async () => {
    const result = await filterOutput(base(grepLike(), { mode: "aggressive" }));
    const excerptBytes = result.excerpts.reduce((n, e) => n + Buffer.byteLength(e.text), 0);
    expect(excerptBytes).toBeGreaterThan(0);
    expect(result.returnedBytes).toBeGreaterThan(Buffer.byteLength(result.summary));
  });

  it("keeps a truncated top excerpt when every chunk exceeds the budget", async () => {
    // one very long line per chunk: each 40-line chunk far exceeds the
    // 4000-byte aggressive budget, so the greedy fit keeps zero and the
    // floor must keep exactly one truncated top excerpt within budget.
    const huge = Array.from({ length: 200 }, (_, i) => `line ${i} ${"x".repeat(500)}`).join("\n");
    const result = await filterOutput(base(huge, { mode: "aggressive" }));
    expect(result.decision).toBe("compressed");
    expect(result.excerpts).toHaveLength(1);
    expect(result.warnings).toContain(
      "specialized compression produced no excerpts; returned generic excerpt",
    );
    const excerptBytes = result.excerpts.reduce((n, e) => n + Buffer.byteLength(e.text), 0);
    expect(excerptBytes).toBeLessThanOrEqual(4000); // aggressive budget
  });
});

describe("filterOutput outline branch", () => {
  // Tiny file: its skeleton (header + import line + 2 signatures) is LARGER
  // than the raw bodies, so the size floor sends it to a normal read.
  const TINY_TS_SRC = `import { z } from "zod";

export function alpha(a: number): number {
  return a + 1;
}

export function beta(b: number): number {
  return b * 2;
}
`;

  // Multi-declaration file with real bodies: the signature-only skeleton is
  // meaningfully smaller than raw, so outline wins.
  const LARGE_TS_SRC = `import { z } from "zod";
import { readFile } from "node:fs/promises";

export function alpha(a: number): number {
  const doubled = a * 2;
  const plus = doubled + 1;
  return plus;
}

export function beta(b: number): number {
  const squared = b * b;
  const minus = squared - 1;
  return minus;
}

export async function gamma(path: string): Promise<string> {
  const raw = await readFile(path, "utf8");
  const trimmed = raw.trim();
  return trimmed;
}

export function delta(values: number[]): number {
  let sum = 0;
  for (const v of values) {
    sum += v;
  }
  return sum;
}
`;

  it("returns a skeleton excerpt plus body chunks when outline saves context", async () => {
    const result = await filterOutput({
      raw: LARGE_TS_SRC,
      mode: "safe",
      outline: true,
      source: { kind: "file", path: "a.ts" },
    });
    expect(result.decision).toBe("outline");
    expect(result.excerpts).toHaveLength(1);
    expect(result.excerpts[0]?.text).toContain("export function alpha");
    expect(result.chunks).toBeDefined();
    expect(result.chunks?.some((c) => c.text.includes("return plus;"))).toBe(true);
    // Floor is satisfied: the skeleton clears the 0.9 ratio (real saving),
    // not merely "smaller than raw".
    expect(result.returnedBytes).toBeLessThan(result.rawBytes * 0.9);
  });

  it("falls back to a normal read when the skeleton would not save context", async () => {
    // outlineFile returns a valid skeleton here (it is a real .ts file with
    // two functions), but the skeleton is larger than the raw bodies, so the
    // size floor declines the outline branch.
    const result = await filterOutput({
      raw: TINY_TS_SRC,
      mode: "safe",
      outline: true,
      source: { kind: "file", path: "a.ts" },
    });
    expect(result.decision).not.toBe("outline");
    expect(result.chunks).toBeUndefined();
  });

  it("ignores outline for a non-file source (falls back to normal filtering)", async () => {
    const result = await filterOutput({ raw: LARGE_TS_SRC, mode: "safe", outline: true });
    expect(result.decision).not.toBe("outline");
    expect(result.chunks).toBeUndefined();
  });

  it("behaves exactly as today when outline is absent", async () => {
    const result = await filterOutput({
      raw: LARGE_TS_SRC,
      mode: "safe",
      source: { kind: "file", path: "a.ts" },
    });
    expect(result.decision).not.toBe("outline");
    expect(result.chunks).toBeUndefined();
  });
});

describe("filterOutput diagnostic dedupe exemption (distinct diagnostics survive)", () => {
  it("keeps every distinct tsc diagnostic (no simhash collapse of distinct codes)", async () => {
    // 90 distinct `error TSxxxx` lines, each a different file/line/code. They
    // are near-duplicates to simhash, so a blanket dedupe would collapse most.
    // A generous byte budget isolates dedupe as the only possible cause of
    // loss: every distinct code must reach the kept excerpts.
    const N = 90;
    const lines = Array.from(
      { length: N },
      (_, i) =>
        `src/area/module${i}/handler${i}.ts(${10 + i},${(i % 9) + 1}): error TS${2300 + i}: diagnostic message number ${i} explaining the type problem in detail.`,
    );
    lines.push(`Found ${N} errors in ${N} files.`);
    const raw = `${lines.join("\n")}\n`;

    const result = await filterOutput(
      base(raw, {
        mode: "safe",
        maxReturnedBytes: 200_000,
        source: { kind: "command", command: "tsc", args: ["--noEmit"] },
      }),
    );

    expect(result.decision).toBe("compressed");
    expect(result.classification.category).toBe("typescript");

    const joined = result.excerpts.map((e) => e.text).join("\n");
    const codesKept = new Set(joined.match(/TS\d{3,}/g) ?? []);
    const expectedCodes = Array.from({ length: N }, (_, i) => `TS${2300 + i}`);
    for (const code of expectedCodes) {
      expect(codesKept.has(code)).toBe(true);
    }
    expect(codesKept.size).toBe(N);
  });

  it("regression: generic near-duplicate noise is still deduped", async () => {
    // The exemption must not disable dedupe globally. A large generic blob of
    // near-identical lines (no diagnostic classification) must still collapse.
    const dup = Array.from(
      { length: 400 },
      (_, i) =>
        `processed record batch with status ok and trailing punctuation ${".".repeat(i % 3)}`,
    );
    const raw = `${dup.join("\n")}\nunique tail marker line\n`;

    const result = await filterOutput(base(raw, { mode: "aggressive", maxReturnedBytes: 200_000 }));

    expect(result.decision).toBe("compressed");
    expect(["generic_shell", "unknown"]).toContain(result.classification.category);
    // Near-duplicate lines collapse: far fewer excerpts than input lines.
    expect(result.excerpts.length).toBeLessThan(dup.length);
  });
});
