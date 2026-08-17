import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReviewPackError } from "../src/errors.js";
import {
  assertCleanTree,
  changedLineRanges,
  defaultExecGit,
  fileAtHead,
  listChangedFiles,
  listCommits,
  repoTopLevel,
  resolveRange,
  unifiedDiff,
} from "../src/git.js";
import { git, initFixtureRepo } from "./fixture.js";

describe("review-pack git module", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "megasaver-rp-git-"));
    initFixtureRepo(repo);
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("resolves top level and passes the clean-tree gate", () => {
    expect(repoTopLevel(repo, defaultExecGit)).toBe(git(repo, "rev-parse", "--show-toplevel").trim());
    expect(() => assertCleanTree(repo, defaultExecGit)).not.toThrow();
  });

  it("fails closed on a dirty worktree", () => {
    writeFileSync(join(repo, "alpha.ts"), "// dirty\n");
    expect(() => assertCleanTree(repo, defaultExecGit)).toThrow(ReviewPackError);
    try {
      assertCleanTree(repo, defaultExecGit);
    } catch (err) {
      expect((err as ReviewPackError).code).toBe("dirty_worktree");
    }
  });

  it("resolves a feature range and reads commits, files, hunks", () => {
    git(repo, "checkout", "-b", "feat/x");
    writeFileSync(
      join(repo, "alpha.ts"),
      "export function alpha(): number {\n  return 42;\n}\n",
    );
    git(repo, "add", "alpha.ts");
    git(repo, "commit", "-m", "fix(core): alpha returns 42");
    const range = resolveRange(repo, "main..HEAD", defaultExecGit);
    expect(listCommits(repo, range, defaultExecGit).map((c) => c.subject)).toEqual([
      "fix(core): alpha returns 42",
    ]);
    expect(listChangedFiles(repo, range, defaultExecGit)).toEqual([
      { path: "alpha.ts", status: "M" },
    ]);
    expect(changedLineRanges(repo, range, "alpha.ts", defaultExecGit)).toEqual([
      { start: 2, end: 2 },
    ]);
    expect(unifiedDiff(repo, range, defaultExecGit)).toContain("-  return 1;");
    expect(fileAtHead(repo, range.headSha, "alpha.ts", defaultExecGit)).toContain("return 42");
  });

  it("throws bad_range on an unresolvable range", () => {
    expect(() => resolveRange(repo, "nope..HEAD", defaultExecGit)).toThrow(ReviewPackError);
  });

  it("throws git_unavailable outside a repo", () => {
    const plain = mkdtempSync(join(tmpdir(), "megasaver-rp-plain-"));
    try {
      expect(() => assertCleanTree(plain, defaultExecGit)).toThrow(ReviewPackError);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
