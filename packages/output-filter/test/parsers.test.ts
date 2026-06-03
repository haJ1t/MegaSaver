import { describe, expect, it } from "vitest";
import { detectCargoTest, parseCargoTest } from "../src/parsers/cargo-test.js";
import { detectEslint, parseEslint } from "../src/parsers/eslint.js";
import { detectGoTest, parseGoTest } from "../src/parsers/go-test.js";
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

const GO_TEST = [
  "=== RUN   TestAdd",
  "--- PASS: TestAdd (0.00s)",
  "=== RUN   TestDivide",
  "    math_test.go:15: Divide(1, 0) = 0; want error",
  "--- FAIL: TestDivide (0.00s)",
  "=== RUN   TestParse",
  '    parse_test.go:22: parse("x") = 0; want 1',
  "--- FAIL: TestParse (0.00s)",
  "FAIL",
  "exit status 1",
  "FAIL\texample.com/math\t0.012s",
].join("\n");

const CARGO_TEST = [
  "running 3 tests",
  "test tests::test_add ... ok",
  "test tests::test_divide ... FAILED",
  "test tests::test_parse ... FAILED",
  "",
  "failures:",
  "",
  "---- tests::test_divide stdout ----",
  "thread 'tests::test_divide' panicked at src/lib.rs:20:9:",
  "assertion `left == right` failed",
  "  left: 0",
  "  right: 1",
  "",
  "---- tests::test_parse stdout ----",
  "thread 'tests::test_parse' panicked at src/lib.rs:28:9:",
  "called `Result::unwrap()` on an `Err` value: ParseError",
  "",
  "failures:",
  "    tests::test_divide",
  "    tests::test_parse",
  "",
  "test result: FAILED. 1 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s",
].join("\n");

const ESLINT = [
  "/app/src/foo.ts",
  "  3:7   error    'x' is assigned a value but never used  no-unused-vars",
  "  10:1  warning  Unexpected console statement             no-console",
  "",
  "/app/src/bar.ts",
  "  1:1   error    Strings must use singlequote             quotes",
  "",
  "✖ 3 problems (2 errors, 1 warning)",
  "  1 warning potentially fixable with the `--fix` option.",
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

describe("go test parser", () => {
  it("detects go test output and rejects unrelated text", () => {
    expect(detectGoTest(GO_TEST)).toBe(true);
    expect(detectGoTest(PLAIN)).toBe(false);
    expect(detectGoTest(PYTEST)).toBe(false);
  });

  it("produces one chunk per failing test, collapsing passes", () => {
    const chunks = parseGoTest(GO_TEST);
    const failures = chunks.filter((c) => c.text.includes("--- FAIL:"));
    expect(failures).toHaveLength(2);
    expect(failures[0]?.text).toContain("TestDivide");
    expect(failures[0]?.text).toContain("Divide(1, 0) = 0; want error");
    expect(failures[1]?.text).toContain("TestParse");
    // The passing TestAdd must not appear in any failure chunk.
    expect(failures.some((c) => c.text.includes("TestAdd"))).toBe(false);
  });
});

describe("cargo test parser", () => {
  it("detects cargo test output and rejects unrelated text", () => {
    expect(detectCargoTest(CARGO_TEST)).toBe(true);
    expect(detectCargoTest(PLAIN)).toBe(false);
    expect(detectCargoTest(GO_TEST)).toBe(false);
  });

  it("produces one chunk per failing test stdout block", () => {
    const chunks = parseCargoTest(CARGO_TEST);
    const failures = chunks.filter((c) => c.text.includes("stdout ----"));
    expect(failures).toHaveLength(2);
    expect(failures[0]?.text).toContain("tests::test_divide");
    expect(failures[0]?.text).toContain("assertion `left == right` failed");
    expect(failures[1]?.text).toContain("tests::test_parse");
    expect(failures[1]?.text).toContain("ParseError");
  });
});

describe("eslint parser", () => {
  it("detects eslint stylish output and rejects unrelated text", () => {
    expect(detectEslint(ESLINT)).toBe(true);
    expect(detectEslint(PLAIN)).toBe(false);
    expect(detectEslint(TEST_OUTPUT)).toBe(false);
  });

  it("produces one chunk per file problem group, keeping rules and locations", () => {
    const chunks = parseEslint(ESLINT);
    const groups = chunks.filter((c) => /^\/app\/src\//m.test(c.text));
    expect(groups).toHaveLength(2);
    expect(groups[0]?.text).toContain("/app/src/foo.ts");
    expect(groups[0]?.text).toContain("no-unused-vars");
    expect(groups[0]?.text).toContain("3:7");
    expect(groups[1]?.text).toContain("/app/src/bar.ts");
    expect(groups[1]?.text).toContain("quotes");
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

  it("routes go test output to the go-test parser, not generic test-output", () => {
    const chunks = chunkByFormat(GO_TEST);
    const block = chunks.find((c) => c.text.includes("--- FAIL: TestDivide"));
    // Generic test-output would split the FAIL detail onto its own line;
    // go-test keeps the failure message with its --- FAIL: marker.
    expect(block?.text).toContain("Divide(1, 0) = 0; want error");
  });

  it("routes cargo test output to the cargo-test parser", () => {
    const chunks = chunkByFormat(CARGO_TEST);
    const block = chunks.find((c) => c.text.includes("tests::test_divide stdout ----"));
    // cargo keeps the panic message with its stdout block, not line-split.
    expect(block?.text).toContain("assertion `left == right` failed");
  });

  it("routes eslint output to the eslint parser (file group stays whole)", () => {
    const chunks = chunkByFormat(ESLINT);
    const group = chunks.find((c) => c.text.includes("/app/src/foo.ts"));
    // The file header and its rule rows stay in one chunk.
    expect(group?.text).toContain("no-unused-vars");
  });
});
