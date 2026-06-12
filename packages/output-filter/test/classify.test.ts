import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_CONFIDENCE_FLOOR,
  classifyOutput,
  isConfidentClassification,
} from "../src/classify.js";

const ESC = "\u001b";

// Vitest default reporter, plain.
const VITEST_PLAIN = [
  " ✓ src/a.test.ts (3 tests) 12ms",
  " ❯ src/b.test.ts (2 tests | 1 failed) 20ms",
  "   × adds numbers",
  "     → expected 3 to be 4",
  "",
  " Test Files  1 failed | 1 passed (2)",
  "      Tests  1 failed | 4 passed (5)",
  "   Duration  1.20s",
].join("\n");

// Vitest verbose reporter with an assertion error.
const VITEST_VERBOSE = [
  "FAIL src/c.test.ts > thing works",
  "AssertionError: expected true to be false",
  " ❯ src/c.test.ts:10:7",
  "",
  " Test Files  1 failed (1)",
  "      Tests  1 failed (1)",
].join("\n");

// Same as plain but with ANSI colour codes (proves strip-before-classify).
const VITEST_ANSI = [
  ` ${ESC}[32m✓${ESC}[0m src/a.test.ts (3 tests) 12ms`,
  ` ${ESC}[31m❯ src/b.test.ts (2 tests | 1 failed)${ESC}[0m 20ms`,
  "",
  ` ${ESC}[2m Test Files ${ESC}[0m 1 failed | 1 passed (2)`,
  ` ${ESC}[2m      Tests ${ESC}[0m 1 failed | 4 passed (5)`,
  "   Duration  1.20s",
].join("\n");

// tsc default output, plain.
const TSC_PLAIN = [
  "src/foo.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
  "src/bar.ts(3,1): error TS2304: Cannot find name 'x'.",
  "Found 2 errors in 2 files.",
].join("\n");

// tsc --pretty with ANSI colour codes.
const TSC_PRETTY_ANSI = [
  `${ESC}[96msrc/foo.ts${ESC}[0m:${ESC}[93m12${ESC}[0m:${ESC}[93m5${ESC}[0m - ${ESC}[91merror${ESC}[0m ${ESC}[90mTS2322:${ESC}[0m Type mismatch.`,
  "",
  `${ESC}[96mFound 1 error.${ESC}[0m`,
].join("\n");

const SHELL_PLAIN = [".", "..", "file1", "file2", "node_modules"].join("\n");

const UNKNOWN_TEXT = ["hello world", "some random log line", "done"].join("\n");

describe("classifyOutput — command matching (P1 §10.3)", () => {
  it("vitest command + vitest output is high confidence vitest", () => {
    const c = classifyOutput({ command: "vitest run", text: VITEST_PLAIN });
    expect(c.category).toBe("vitest");
    expect(c.confidence).toBeGreaterThanOrEqual(0.9);
  });
  it("npm test command is recognised as vitest category", () => {
    const c = classifyOutput({ command: "npm test", text: SHELL_PLAIN });
    expect(c.category).toBe("vitest");
    expect(c.confidence).toBeGreaterThanOrEqual(0.7);
  });
  it("tsc --noEmit command + diagnostics is high confidence typescript", () => {
    const c = classifyOutput({ command: "tsc --noEmit", text: TSC_PLAIN });
    expect(c.category).toBe("typescript");
    expect(c.confidence).toBeGreaterThanOrEqual(0.9);
  });
  it("pnpm typecheck command is recognised as typescript", () => {
    const c = classifyOutput({ command: "pnpm typecheck", text: SHELL_PLAIN });
    expect(c.category).toBe("typescript");
  });
});

describe("classifyOutput — output sniffing without command (P1 §10.3)", () => {
  it("classifies plain vitest output", () => {
    expect(classifyOutput({ text: VITEST_PLAIN }).category).toBe("vitest");
  });
  it("classifies verbose vitest output with AssertionError", () => {
    expect(classifyOutput({ text: VITEST_VERBOSE }).category).toBe("vitest");
  });
  it("classifies plain tsc output", () => {
    expect(classifyOutput({ text: TSC_PLAIN }).category).toBe("typescript");
  });
});

describe("classifyOutput — ANSI stripped before classification (P1 §10.2)", () => {
  it("classifies ANSI-coloured vitest output", () => {
    expect(classifyOutput({ text: VITEST_ANSI }).category).toBe("vitest");
  });
  it("classifies ANSI-coloured tsc --pretty output", () => {
    expect(classifyOutput({ text: TSC_PRETTY_ANSI }).category).toBe("typescript");
  });
});

describe("classifyOutput — generic and unknown fallback (P1 §10.4)", () => {
  it("command present but no category signature -> generic_shell", () => {
    const c = classifyOutput({ command: "ls -a", text: SHELL_PLAIN });
    expect(c.category).toBe("generic_shell");
  });
  it("no command and no signature -> unknown below the confidence floor", () => {
    const c = classifyOutput({ text: UNKNOWN_TEXT });
    expect(c.category).toBe("unknown");
    expect(c.confidence).toBeLessThan(CLASSIFICATION_CONFIDENCE_FLOOR);
  });
  it("isConfidentClassification gates specialized dispatch", () => {
    expect(
      isConfidentClassification(classifyOutput({ command: "vitest", text: VITEST_PLAIN })),
    ).toBe(true);
    expect(isConfidentClassification(classifyOutput({ text: UNKNOWN_TEXT }))).toBe(false);
  });
});

describe("classifyOutput — mixed stdout/stderr", () => {
  it("typescript diagnostics win over interleaved shell noise", () => {
    const mixed = [SHELL_PLAIN, TSC_PLAIN].join("\n");
    expect(classifyOutput({ text: mixed }).category).toBe("typescript");
  });
});
