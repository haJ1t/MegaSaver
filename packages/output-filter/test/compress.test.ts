import { describe, expect, it } from "vitest";
import { compressByCategory } from "../src/compress/index.js";
import { compressTsc } from "../src/compress/tsc.js";
import { compressVitest } from "../src/compress/vitest.js";
import { estimateTokens } from "../src/tokens.js";

const VITEST_MIX = [
  " ✓ src/a.test.ts > passes one (2ms)",
  " ✓ src/a.test.ts > passes two (1ms)",
  " ❯ src/b.test.ts > adds numbers",
  "   × adds numbers",
  "     AssertionError: expected 3 to be 4",
  "     ❯ src/b.test.ts:10:7",
  "",
  " Test Files  1 failed | 1 passed (2)",
  "      Tests  1 failed | 2 passed (3)",
  "   Duration  1.20s",
].join("\n");

const TSC_MIX = [
  "src/a.ts(1,1): error TS2304: Cannot find name 'x'.",
  "src/a.ts(2,2): error TS2304: Cannot find name 'y'.",
  "src/b.ts(5,5): error TS2322: Type mismatch.",
  "src/a.ts(1,1): error TS2304: Cannot find name 'x'.",
  "  cascading type expansion noise that nobody needs",
  "Found 3 errors in 2 files.",
].join("\n");

describe("compressVitest (Deliverable 3)", () => {
  const out = compressVitest(VITEST_MIX);
  it("keeps failing test, assertion, stack frame and summary", () => {
    expect(out).toContain("adds numbers");
    expect(out).toContain("AssertionError: expected 3 to be 4");
    expect(out).toContain("src/b.test.ts:10:7");
    expect(out).toContain("Test Files");
    expect(out).toContain("Duration");
  });
  it("collapses passing tests", () => {
    expect(out).not.toContain("passes one");
    expect(out).not.toContain("passes two");
    expect(out).toMatch(/2 passing/);
  });
  it("is smaller than the raw input", () => {
    expect(out.length).toBeLessThan(VITEST_MIX.length);
  });
});

describe("compressTsc (Deliverable 4)", () => {
  const out = compressTsc(TSC_MIX);
  it("keeps distinct errors with code, file and position", () => {
    expect(out).toContain("TS2304");
    expect(out).toContain("TS2322");
    expect(out).toContain("src/a.ts");
    expect(out).toContain("src/b.ts");
  });
  it("groups by file with a top-files header", () => {
    expect(out).toMatch(/src\/a\.ts.*2/);
  });
  it("dedupes identical cascading errors", () => {
    const occurrences = out.split("Cannot find name 'x'").length - 1;
    expect(occurrences).toBe(1);
  });
  it("drops non-error cascading noise", () => {
    expect(out).not.toContain("cascading type expansion noise");
  });
  it("keeps the error count summary", () => {
    expect(out).toContain("Found 3 errors");
  });
});

describe("compressByCategory dispatch", () => {
  it("routes vitest", () => {
    expect(compressByCategory("vitest", VITEST_MIX).compressor).toBe("vitest");
  });
  it("routes typescript", () => {
    expect(compressByCategory("typescript", TSC_MIX).compressor).toBe("typescript");
  });
  it("passes generic categories through unchanged", () => {
    const r = compressByCategory("generic_shell", "a\nb\nc");
    expect(r.compressor).toBe("generic");
    expect(r.text).toBe("a\nb\nc");
  });
});

describe("estimateTokens", () => {
  it("approximates 4 bytes per token", () => {
    expect(estimateTokens("aaaa")).toBe(1);
    expect(estimateTokens("a".repeat(4000))).toBe(1000);
  });
});
