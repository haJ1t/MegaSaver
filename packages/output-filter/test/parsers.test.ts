import { describe, expect, it } from "vitest";
import { chunkByFormat } from "../src/parsers/index.js";
import { detectPytest, parsePytest } from "../src/parsers/pytest.js";
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

const PYTEST = [
  "============================= test session starts ==============================",
  "collected 3 items",
  "",
  "tests/test_math.py ..F                                                    [100%]",
  "",
  "=================================== FAILURES ===================================",
  "_______________________________ test_division _________________________________",
  "",
  "    def test_division():",
  ">       assert divide(1, 0) == 0",
  "E       ZeroDivisionError: division by zero",
  "",
  "tests/test_math.py:8: ZeroDivisionError",
  "_________________________________ test_parse __________________________________",
  "",
  "    def test_parse():",
  '>       assert parse("x") == 1',
  "E       assert 0 == 1",
  "",
  "tests/test_math.py:14: AssertionError",
  "=========================== short test summary info ============================",
  "FAILED tests/test_math.py::test_division - ZeroDivisionError: division by zero",
  "FAILED tests/test_math.py::test_parse - assert 0 == 1",
  "========================= 2 failed, 1 passed in 0.05s ==========================",
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

describe("pytest parser", () => {
  it("detects pytest output and rejects unrelated text", () => {
    expect(detectPytest(PYTEST)).toBe(true);
    expect(detectPytest(PLAIN)).toBe(false);
    expect(detectPytest(TEST_OUTPUT)).toBe(false);
  });

  it("produces one chunk per failed test plus the summary", () => {
    const chunks = parsePytest(PYTEST);
    const failures = chunks.filter((c) => c.text.includes("def test_"));
    expect(failures).toHaveLength(2);
    expect(failures[0]?.text).toContain("test_division");
    expect(failures[0]?.text).toContain("ZeroDivisionError: division by zero");
    expect(failures[1]?.text).toContain("test_parse");
    expect(failures[1]?.text).toContain("assert 0 == 1");
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

describe("chunkByFormat routes each fixture to the right parser", () => {
  it("routes pytest output to the pytest parser (failure block stays whole)", () => {
    const chunks = chunkByFormat(PYTEST);
    const block = chunks.find((c) => c.text.includes("test_division"));
    // The generic test-output parser splits every line; pytest keeps the
    // traceback + assertion together in one chunk.
    expect(block?.text).toContain("ZeroDivisionError: division by zero");
  });
});
