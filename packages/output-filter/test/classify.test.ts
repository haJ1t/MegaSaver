import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_CONFIDENCE_FLOOR,
  classifyOutput,
  isConfidentClassification,
} from "../src/classify.js";
import { compressByCategory } from "../src/compress/index.js";

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

// Unified diff (git diff default), plain.
const DIFF_PLAIN = [
  "diff --git a/src/foo.ts b/src/foo.ts",
  "index 1234567..89abcde 100644",
  "--- a/src/foo.ts",
  "+++ b/src/foo.ts",
  "@@ -1,5 +1,5 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  " const c = 4;",
].join("\n");

// git status --short style output (no diff --git header).
const STATUS_PLAIN = [" M src/foo.ts", "?? src/new.ts", " D src/old.ts"].join("\n");

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

describe("classifyOutput — diff category", () => {
  it("git diff command + unified diff output is high confidence diff", () => {
    const c = classifyOutput({ command: "git diff", text: DIFF_PLAIN });
    expect(c.category).toBe("diff");
    expect(c.confidence).toBeGreaterThanOrEqual(0.9);
  });
  it("git status command is recognised as diff category", () => {
    const c = classifyOutput({ command: "git status", text: STATUS_PLAIN });
    expect(c.category).toBe("diff");
    expect(c.confidence).toBeGreaterThanOrEqual(0.7);
  });
  it("sniffs unified diff output without a command", () => {
    expect(classifyOutput({ text: DIFF_PLAIN }).category).toBe("diff");
  });
  it("isConfidentClassification gates diff dispatch", () => {
    expect(
      isConfidentClassification(classifyOutput({ command: "git diff", text: DIFF_PLAIN })),
    ).toBe(true);
  });

  it("does NOT route generic output with a lone leading +/- to diff", () => {
    // npm/console output: leading +/- without a diff header or hunk must
    // not be a confident diff (would route to compressStat and lose data).
    const consoleLog = ["+ building app", "- done", "ready in 3s"].join("\n");
    const c = classifyOutput({ text: consoleLog });
    expect(c.category).not.toBe("diff");
    expect(isConfidentClassification(c)).toBe(false);
  });

  it("does NOT route a markdown bullet list (leading -) to diff", () => {
    const bullets = ["# Notes", "- first item", "- second item", "- third item"].join("\n");
    const c = classifyOutput({ text: bullets });
    expect(c.category).not.toBe("diff");
  });

  it("does NOT route an ASCII pipe table to diff", () => {
    const table = [
      "| name  | count |",
      "|-------|-------|",
      "| alpha | 3     |",
      "| beta  | 7     |",
    ].join("\n");
    const c = classifyOutput({ text: table });
    expect(c.category).not.toBe("diff");
  });
});

describe("classifyOutput — structured category", () => {
  // A large homogeneous JSON array — the only shape the schematizer fires on.
  const LARGE_JSON_ARRAY = JSON.stringify(
    Array.from({ length: 50 }, (_, i) => ({ id: i, name: `n${i}` })),
  );

  it("sniffs a large homogeneous JSON array as structured", () => {
    const c = classifyOutput({ text: LARGE_JSON_ARRAY });
    expect(c.category).toBe("structured");
    expect(isConfidentClassification(c)).toBe(true);
  });

  it("recognises a *.json path as structured", () => {
    const c = classifyOutput({ path: "package-lock.json", text: LARGE_JSON_ARRAY });
    expect(c.category).toBe("structured");
  });

  it("recognises cat *.json / jq commands as structured", () => {
    expect(classifyOutput({ command: "cat data.json", text: LARGE_JSON_ARRAY }).category).toBe(
      "structured",
    );
    expect(classifyOutput({ command: "jq . data.json", text: LARGE_JSON_ARRAY }).category).toBe(
      "structured",
    );
  });

  it("does NOT route a small JSON array to structured (falls through)", () => {
    const small = JSON.stringify([{ id: 1 }, { id: 2 }]);
    const c = classifyOutput({ text: small });
    expect(c.category).not.toBe("structured");
  });

  it("does NOT route a non-array JSON object to structured", () => {
    const obj = JSON.stringify({ a: 1, b: 2 });
    const c = classifyOutput({ text: obj });
    expect(c.category).not.toBe("structured");
  });

  it("does NOT route an array of primitives to structured", () => {
    const prims = JSON.stringify(Array.from({ length: 50 }, (_, i) => i));
    const c = classifyOutput({ text: prims });
    expect(c.category).not.toBe("structured");
  });

  it("does NOT route malformed JSON to structured (no throw)", () => {
    const bad = '[{"id": 1}, {"id": 2}, ';
    expect(() => classifyOutput({ text: bad })).not.toThrow();
    expect(classifyOutput({ text: bad }).category).not.toBe("structured");
  });
});

describe("compressByCategory — structured dispatch", () => {
  const LARGE_JSON_ARRAY = JSON.stringify(
    Array.from({ length: 100 }, (_, i) => ({ id: i, name: `n${i}` })),
    null,
    2,
  );

  it("routes structured to the json compressor and collapses the array", () => {
    const r = compressByCategory("structured", LARGE_JSON_ARRAY);
    expect(r.compressor).toBe("structured");
    expect(r.text).toMatch(/\[\d+ more of same shape\]/);
  });

  it("threads intent through to force-keep a key", () => {
    const arr = JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({ id: i, email: `u${i}@x.io` })),
      null,
      2,
    );
    const r = compressByCategory("structured", arr, "show me the email");
    expect(r.text).toContain("email");
  });
});

describe("classifyOutput — mixed stdout/stderr", () => {
  it("typescript diagnostics win over interleaved shell noise", () => {
    const mixed = [SHELL_PLAIN, TSC_PLAIN].join("\n");
    expect(classifyOutput({ text: mixed }).category).toBe("typescript");
  });
});

// ─── prose category ───────────────────────────────────────────────────────────

const MARKDOWN_DOC = [
  "# Getting Started",
  "",
  "Install the package using npm:",
  "",
  "```bash",
  "npm install",
  "```",
  "",
  "Then run the dev server.",
  "",
  "# Configuration",
  "",
  "Create a config file at `config.json`.",
  "",
  "Add your settings there.",
].join("\n");

const LONG_MARKDOWN = [
  "# Section One",
  "",
  "First paragraph of section one. This introduces the concept.",
  "",
  "Second paragraph with more details that will be collapsed.",
  "",
  "Third paragraph, also collapsed by the compressor.",
  "",
  "Fourth paragraph, still collapsed.",
  "",
  "Fifth paragraph, also collapsed.",
  "",
  "Sixth paragraph, also collapsed.",
  "",
  "# Section Two",
  "",
  "First paragraph of section two. Kept verbatim.",
  "",
  "```typescript",
  "const x = 1;",
  "```",
  "",
  "More details after the code block, collapsed.",
  "",
  "Even more details, also collapsed.",
].join("\n");

describe("classifyOutput — prose category", () => {
  it("classifies markdown with headings + code blocks as prose", () => {
    const c = classifyOutput({ text: MARKDOWN_DOC });
    expect(c.category).toBe("prose");
    expect(isConfidentClassification(c)).toBe(true);
  });

  it("classifies markdown with only headings as prose (lower confidence)", () => {
    const headingsOnly = "# Intro\n\nSome text.\n\n# Usage\n\nMore text.";
    const c = classifyOutput({ text: headingsOnly });
    expect(c.category).toBe("prose");
  });

  it("classifies a fetch-source markdown doc as prose", () => {
    const c = classifyOutput({ source: "fetch", text: MARKDOWN_DOC });
    expect(c.category).toBe("prose");
  });

  it("classifies cat *.md command as prose", () => {
    const c = classifyOutput({ command: "cat README.md", text: MARKDOWN_DOC });
    expect(c.category).toBe("prose");
    expect(c.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("does NOT misclassify a git diff as prose", () => {
    const c = classifyOutput({ text: "diff --git a/foo b/foo\n@@ -1 +1 @@\n-old\n+new" });
    expect(c.category).not.toBe("prose");
  });

  it("does NOT misclassify tsc output as prose", () => {
    const c = classifyOutput({
      text: "src/foo.ts(1,1): error TS2304: Cannot find name 'x'.",
    });
    expect(c.category).not.toBe("prose");
  });

  it("does NOT misclassify vitest output as prose", () => {
    const c = classifyOutput({
      text: " Test Files  1 failed | 1 passed (2)\n      Tests  1 failed | 4 passed (5)",
    });
    expect(c.category).not.toBe("prose");
  });

  it("does NOT misclassify plain shell log as prose", () => {
    const shellLog = [".", "..", "file1.ts", "file2.ts", "node_modules"].join("\n");
    const c = classifyOutput({ command: "ls", text: shellLog });
    expect(c.category).not.toBe("prose");
  });

  it("does NOT misclassify large JSON array as prose", () => {
    const arr = JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ id: i, name: `n${i}` })));
    const c = classifyOutput({ text: arr });
    expect(c.category).not.toBe("prose");
  });
});

describe("compressByCategory — prose dispatch", () => {
  it("routes prose to the prose compressor", () => {
    const r = compressByCategory("prose", MARKDOWN_DOC);
    expect(r.compressor).toBe("prose");
  });

  it("prose compressor reduces a long markdown doc", () => {
    const r = compressByCategory("prose", LONG_MARKDOWN);
    expect(r.text.length).toBeLessThan(LONG_MARKDOWN.length);
  });
});
