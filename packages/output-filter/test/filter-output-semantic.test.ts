import { describe, expect, it } from "vitest";
import { type FilterOutputInput, filterOutput } from "../src/types.js";

const base = (raw: string, overrides: Partial<FilterOutputInput> = {}): FilterOutputInput => ({
  raw,
  mode: "balanced",
  ...overrides,
});

// A file body large enough to cross the compression threshold so the
// compressed-band path (where compressor + dedupe live) is exercised.
function bigTsFile(): string {
  const fns = Array.from({ length: 40 }, (_, i) => `export function fn${i}() {\n  return ${i};\n}`);
  return `${fns.join("\n\n")}\n`;
}

describe("filterOutput semantic file read (T4)", () => {
  it("produces function-aligned excerpts for a .ts file source", () => {
    const raw = bigTsFile();
    const result = filterOutput(
      base(raw, { source: { kind: "file", path: "big.ts" }, intent: "fn7" }),
    );
    expect(result.excerpts.length).toBeGreaterThan(0);
    // the intent-matched function should survive ranking + budget
    expect(result.excerpts.some((e) => e.text.includes("function fn7"))).toBe(true);
  });

  it("never rewrites a .ts file body through the command-output compressor", () => {
    // body literally contains a tsc-style diagnostic; without the file guard
    // this classifies as typescript (conf 0.7) and the body is rebuilt into a
    // synthetic summary, corrupting every line span. The guard keeps it raw.
    const lines = Array.from({ length: 50 }, (_, i) => `const c${i} = ${i};`);
    const raw = [
      "export function withDiag() {",
      "  const msg = 'src/x.ts(12,5): error TS2322: bad';",
      ...lines,
      "  return msg;",
      "}",
    ].join("\n");
    const result = filterOutput(
      base(raw, { source: { kind: "file", path: "diag.ts" }, intent: "withDiag" }),
    );
    expect(result.compressor).toBe("generic");
    // real source text survives — not a 'Top files by error count' summary
    expect(result.excerpts.some((e) => e.text.includes("export function withDiag"))).toBe(true);
    expect(result.summary).not.toContain("Top files");
  });

  it("keeps structurally similar declarations: dedupe does NOT drop semantic chunks", () => {
    // many near-identical one-line JSON keys: simhash would collide within 3
    // bits and dedupe would erase them for a command source. For a file source
    // dedupe is skipped, so the count is preserved.
    const entries = Array.from({ length: 30 }, (_, i) => `  \"keyAAAA${i}\": ${i}`);
    const raw = `{\n${entries.join(",\n")}\n}`;
    const fileResult = filterOutput(base(raw, { source: { kind: "file", path: "data.json" } }));
    // every key block survives (no dedupe collapse) — well above what dedupe
    // would leave if it ran on near-identical one-liners
    expect(fileResult.excerpts.length).toBeGreaterThan(10);
  });

  it("command source still line-chunks and still dedupes (unchanged path)", () => {
    const raw = Array.from({ length: 120 }, (_, i) => `build log line number ${i}`).join("\n");
    const result = filterOutput(
      base(raw, { source: { kind: "command", command: "make", args: [] } }),
    );
    // line-chunked windows, not function-aligned; just assert it returns excerpts
    expect(result.excerpts.length).toBeGreaterThan(0);
  });

  it("unsupported file extension falls back to line chunks", () => {
    const raw = Array.from({ length: 120 }, (_, i) => `csv,row,${i}`).join("\n");
    const result = filterOutput(base(raw, { source: { kind: "file", path: "rows.csv" } }));
    expect(result.excerpts.length).toBeGreaterThan(0);
  });
});
