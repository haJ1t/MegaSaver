import { describe, expect, it } from "vitest";
import { compressDiff } from "../src/compress/diff.js";
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

// Unified diff: 2 changed lines surrounded by a long unchanged run.
const DIFF_UNIFIED = [
  "diff --git a/src/foo.ts b/src/foo.ts",
  "index 1234567..89abcde 100644",
  "--- a/src/foo.ts",
  "+++ b/src/foo.ts",
  "@@ -1,12 +1,12 @@",
  " line 1 unchanged",
  " line 2 unchanged",
  " line 3 unchanged",
  " line 4 unchanged",
  " line 5 unchanged",
  "-removed line six",
  "+added line six",
  " line 7 unchanged",
  " line 8 unchanged",
  " line 9 unchanged",
  " line 10 unchanged",
  " line 11 unchanged",
  " line 12 unchanged",
].join("\n");

// git log --stat with an ASCII graph and a stat summary.
const DIFF_STAT = [
  "* commit abc123 (HEAD -> main)",
  "| Author: Dev <dev@example.com>",
  "|",
  "|     feat: add thing",
  "|",
  "| src/foo.ts | 4 ++--",
  "| src/bar.ts | 2 +-",
  "| 2 files changed, 4 insertions(+), 2 deletions(-)",
  "* commit def456",
].join("\n");

describe("compressDiff (Diff-aware compressor)", () => {
  const out = compressDiff(DIFF_UNIFIED);
  it("keeps file headers and hunk headers", () => {
    expect(out).toContain("diff --git a/src/foo.ts b/src/foo.ts");
    expect(out).toContain("--- a/src/foo.ts");
    expect(out).toContain("+++ b/src/foo.ts");
    expect(out).toContain("@@ -1,12 +1,12 @@");
  });
  it("keeps every changed +/- line", () => {
    expect(out).toContain("-removed line six");
    expect(out).toContain("+added line six");
  });
  it("collapses a fully-unchanged run to a marker", () => {
    expect(out).toMatch(/\[\d+ unchanged\]/);
    // The deep middle of the leading unchanged run is dropped.
    expect(out).not.toContain("line 3 unchanged");
  });
  it("keeps one line of context on each side of a change", () => {
    expect(out).toContain("line 5 unchanged");
    expect(out).toContain("line 7 unchanged");
  });
  it("is smaller than the raw input", () => {
    expect(out.length).toBeLessThan(DIFF_UNIFIED.length);
  });

  it("summarises git log --stat: keeps stat + content, collapses spine", () => {
    const stat = compressDiff(DIFF_STAT);
    expect(stat).toContain("src/foo.ts | 4 ++--");
    expect(stat).toContain("2 files changed, 4 insertions(+), 2 deletions(-)");
    // Author/subject lines carry content behind the graph column — keep them.
    expect(stat).toContain("| Author: Dev");
    expect(stat).toContain("|     feat: add thing");
    // Only the lone "|" spine line is collapsed, into a counted marker.
    expect(stat).toMatch(/\[\d+ graph\]/);
  });

  it("keeps a git log --graph content line | * <sha> <subject>", () => {
    const graph = ["* abc123 feat: a", "| * def456 feat: b", "|/", "* 789xyz feat: c"].join("\n");
    const out = compressDiff(graph);
    // The "| * def456 ..." line is a whole commit — never drop it.
    expect(out).toContain("| * def456 feat: b");
    expect(out).toContain("* abc123 feat: a");
    expect(out).toContain("* 789xyz feat: c");
  });

  it("keeps a git log --stat subject containing a literal pipe", () => {
    const piped = [
      "commit abc123",
      "    fix: handle a | b precedence",
      " src/foo.ts | 4 ++--",
      " 1 file changed, 4 insertions(+)",
    ].join("\n");
    const out = compressDiff(piped);
    expect(out).toContain("fix: handle a | b precedence");
    expect(out).toContain("src/foo.ts | 4 ++--");
  });
});

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
  it("routes diff", () => {
    expect(compressByCategory("diff", DIFF_UNIFIED).compressor).toBe("diff");
  });
  it("a non-diff category does not invoke compressDiff", () => {
    // compressDiff only fires on the diff category; generic input falls
    // through to existing behaviour untouched.
    const r = compressByCategory("generic_shell", DIFF_UNIFIED);
    expect(r.compressor).toBe("generic");
    expect(r.text).toBe(DIFF_UNIFIED);
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
