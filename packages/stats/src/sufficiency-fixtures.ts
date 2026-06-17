export type FixtureKind = "failure_evidence" | "actionability";

export interface SufficiencyFixture {
  readonly kind: FixtureKind;
  /** The raw (uncompressed) output text */
  readonly rawContent: string;
  /** A deterministic compressed version of rawContent (pre-computed, static) */
  readonly compressedContent: string;
  /**
   * Substrings or tokens that MUST appear in an acceptable compressed output.
   * Used by failureEvidenceRecall harness: retained = essentials present in
   * compressedContent.
   */
  readonly essentials: readonly string[];
  /**
   * Only present for kind="actionability". A substring that identifies the
   * next action; it must appear in compressedContent for the fixture to pass.
   */
  readonly nextAction?: string;
}

// Inline, deterministic, no IO.
// Three failure-evidence fixtures (test/typecheck/search output patterns).
// Two actionability fixtures (diff output, error with recovery step).
export const SUFFICIENCY_FIXTURES: readonly SufficiencyFixture[] = [
  // --- failure evidence fixtures ---
  {
    kind: "failure_evidence",
    rawContent: [
      "FAIL src/foo.test.ts",
      "  × test case fails",
      "    AssertionError: expected 1 to equal 2",
      "    at foo.test.ts:12:3",
      "PASS src/bar.test.ts",
      "Test Suites: 1 failed, 1 passed",
    ].join("\n"),
    compressedContent: [
      "FAIL src/foo.test.ts × test case fails",
      "AssertionError: expected 1 to equal 2 at foo.test.ts:12:3",
      "Test Suites: 1 failed, 1 passed",
    ].join("\n"),
    essentials: ["FAIL", "AssertionError", "foo.test.ts:12"],
  },
  {
    kind: "failure_evidence",
    rawContent: [
      "error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
      "  src/core.ts:45:9",
      "Found 1 error.",
    ].join("\n"),
    compressedContent: [
      "error TS2345: 'string' not assignable to 'number' src/core.ts:45:9",
      "Found 1 error.",
    ].join("\n"),
    essentials: ["TS2345", "src/core.ts:45", "Found 1 error"],
  },
  {
    kind: "failure_evidence",
    rawContent: [
      "src/util.ts:88:5 - error TS2304: Cannot find name 'foo'.",
      "src/util.ts:92:3 - error TS2304: Cannot find name 'bar'.",
      "Found 2 errors.",
    ].join("\n"),
    compressedContent: [
      "TS2304 src/util.ts:88 Cannot find 'foo'; :92 Cannot find 'bar'.",
      "Found 2 errors.",
    ].join("\n"),
    essentials: ["TS2304", "src/util.ts", "Found 2 errors"],
  },
  // --- actionability fixtures ---
  {
    kind: "actionability",
    rawContent: [
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1,5 +1,6 @@",
      " import { foo } from './foo.js';",
      "+import { bar } from './bar.js';",
      " export { foo };",
    ].join("\n"),
    compressedContent: ["diff src/index.ts: +import { bar } from './bar.js'"].join("\n"),
    essentials: ["src/index.ts", "bar"],
    nextAction: "import { bar }",
  },
  {
    kind: "actionability",
    rawContent: [
      "Error: ENOENT: no such file or directory, open '/tmp/missing.json'",
      "    at Object.openSync (node:fs:600:3)",
      "Hint: run `mega init` to create required files.",
    ].join("\n"),
    compressedContent: ["Error: ENOENT /tmp/missing.json — run `mega init`"].join("\n"),
    essentials: ["ENOENT", "/tmp/missing.json"],
    nextAction: "mega init",
  },
];
