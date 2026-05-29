import { describe, expect, it } from "vitest";
import { chunkByFormat } from "../src/parsers/index.js";
import { detectStacktrace, parseStacktrace } from "../src/parsers/stacktrace.js";
import { detectTestOutput, parseTestOutput } from "../src/parsers/test-output.js";
import { detectTsDiagnostic, parseTsDiagnostic } from "../src/parsers/ts-diagnostic.js";

const TEST_OUTPUT = [
  "PASS  src/a.test.ts",
  "FAIL  src/b.test.ts",
  "  ✓ adds numbers (2 ms)",
  "  ✗ throws on bad input",
  "Tests: 1 failed, 1 passed, 2 total",
].join("\n");

const TS_DIAGNOSTIC = [
  "src/foo.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
  "src/bar.ts(3,1): error TS2304: Cannot find name 'baz'.",
].join("\n");

const STACKTRACE = [
  "Error: boom",
  "    at fn (/app/src/x.ts:10:5)",
  "    at Object.<anonymous> (/app/src/y.ts:2:1)",
].join("\n");

const PLAIN = ["just some prose", "with no special structure", "at all"].join("\n");

describe("test-output parser", () => {
  it("detects test runner output", () => {
    expect(detectTestOutput(TEST_OUTPUT)).toBe(true);
    expect(detectTestOutput(PLAIN)).toBe(false);
  });

  it("produces chunks", () => {
    expect(parseTestOutput(TEST_OUTPUT).length).toBeGreaterThan(0);
  });
});

describe("ts-diagnostic parser", () => {
  it("detects TypeScript diagnostics", () => {
    expect(detectTsDiagnostic(TS_DIAGNOSTIC)).toBe(true);
    expect(detectTsDiagnostic(PLAIN)).toBe(false);
  });

  it("produces chunks", () => {
    expect(parseTsDiagnostic(TS_DIAGNOSTIC).length).toBeGreaterThan(0);
  });
});

describe("stacktrace parser", () => {
  it("detects stack traces", () => {
    expect(detectStacktrace(STACKTRACE)).toBe(true);
    expect(detectStacktrace(PLAIN)).toBe(false);
  });

  it("produces chunks", () => {
    expect(parseStacktrace(STACKTRACE).length).toBeGreaterThan(0);
  });
});

describe("chunkByFormat dispatch (spec §6 stage 4 precedence)", () => {
  it("routes test output to the test-output parser", () => {
    expect(chunkByFormat(TEST_OUTPUT).length).toBeGreaterThan(0);
  });

  it("falls back to line chunking on no format match", () => {
    const chunks = chunkByFormat(PLAIN);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe(PLAIN);
  });
});
