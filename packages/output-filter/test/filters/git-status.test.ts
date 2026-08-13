import { describe, expect, it } from "vitest";
import { compressGitStatus } from "../../src/filters/git-status.js";
import { COMMAND_FILTERS } from "../../src/filters/index.js";
import { assertFilterConformance } from "./conformance.js";

const filter = COMMAND_FILTERS.find((f) => f.name === "git-status");
if (filter === undefined) throw new Error("git-status not registered");

const HUMAN = [
  "On branch main",
  "Your branch is up to date with 'origin/main'.",
  "",
  "Changes not staged for commit:",
  '  (use "git add <file>..." to update what will be committed)',
  '  (use "git restore <file>..." to discard changes in working directory)',
  "\tmodified:   src/index.ts",
  "\tmodified:   package.json",
  "",
  "Untracked files:",
  '  (use "git add <file>..." to include in what will be committed)',
  "\tcoverage/lcov.info",
  "",
  'no changes added to commit (use "git add" and/or "git commit -a")',
].join("\n");

const PORCELAIN = [
  "## main...origin/main [ahead 2]",
  " M src/index.ts",
  " M src/filters/git-status.ts",
  "A  src/filters/index.ts",
  ...Array.from({ length: 24 }, (_, i) => `?? dist/assets/chunk-${i}.js`),
].join("\n");

describe("git-status filter", () => {
  it("drops coaching hint lines behind a counted marker", () => {
    const out = assertFilterConformance(filter, HUMAN);
    expect(out).not.toContain('(use "git add <file>..." to update');
    expect(out).toContain("\tmodified:   src/index.ts");
    expect(out).toContain('no changes added to commit (use "git add" and/or "git commit -a")');
    expect(out).toContain("… [3 hint lines]");
  });

  it("caps a porcelain same-status run and counts the fold", () => {
    const out = assertFilterConformance(filter, PORCELAIN);
    expect(out).toContain(" M src/index.ts");
    expect(out).toContain("?? dist/assets/chunk-19.js");
    expect(out).not.toContain("?? dist/assets/chunk-20.js");
    expect(out).toContain("… [4 more ??]");
  });

  it("returns unrecognized text verbatim", () => {
    expect(compressGitStatus("plain output\nno status shape")).toBe(
      "plain output\nno status shape",
    );
  });

  it("passes porcelain-like lines with a blank status code through verbatim", () => {
    const text = [
      "On branch main",
      "   weird but plausible line",
      "   another spaced line",
      "   third spaced line",
      "   fourth spaced line",
    ].join("\n");
    expect(compressGitStatus(text)).toBe(text);
  });
});
