import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nodeGitFamilyFs, resolveGitCommonDir } from "../src/git-family.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mega-gitfam-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// Minimal valid git dir markers: HEAD + objects/.
function markGitDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "HEAD"), "ref: refs/heads/main\n");
  mkdirSync(join(dir, "objects"), { recursive: true });
}
function dotGitFile(worktree: string, gitdirTarget: string): void {
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(worktree, ".git"), `gitdir: ${gitdirTarget}\n`);
}
// A worktree admin dir under <commonDir>/worktrees/<name>: has commondir + gitdir back-pointer.
function worktreeAdmin(commonDir: string, name: string, backToWorktreeDotGit: string): string {
  const admin = join(commonDir, "worktrees", name);
  mkdirSync(admin, { recursive: true });
  writeFileSync(join(admin, "HEAD"), "ref: refs/heads/wt\n");
  writeFileSync(join(admin, "commondir"), "../..\n");
  writeFileSync(join(admin, "gitdir"), `${backToWorktreeDotGit}\n`);
  return admin;
}

const fs = nodeGitFamilyFs;
const real = (p: string) => nodeGitFamilyFs.realpath(p);

describe("resolveGitCommonDir", () => {
  it("normal repo: .git dir → ok, common dir = realpath(.git)", () => {
    markGitDir(join(root, "repo", ".git"));
    const r = resolveGitCommonDir(join(root, "repo"), fs);
    expect(r).toEqual({ kind: "ok", commonDir: real(join(root, "repo", ".git")) });
  });

  it("nested cwd walks up to the repo .git", () => {
    markGitDir(join(root, "repo", ".git"));
    mkdirSync(join(root, "repo", "src", "deep"), { recursive: true });
    const r = resolveGitCommonDir(join(root, "repo", "src", "deep"), fs);
    expect(r).toEqual({ kind: "ok", commonDir: real(join(root, "repo", ".git")) });
  });

  it("main + linked worktree resolve to the SAME common dir", () => {
    markGitDir(join(root, "repo", ".git"));
    worktreeAdmin(join(root, "repo", ".git"), "wt", join(root, "repo", "wt", ".git"));
    dotGitFile(join(root, "repo", "wt"), join(root, "repo", ".git", "worktrees", "wt"));
    const main = resolveGitCommonDir(join(root, "repo"), fs);
    const wt = resolveGitCommonDir(join(root, "repo", "wt"), fs);
    expect(main).toEqual({ kind: "ok", commonDir: real(join(root, "repo", ".git")) });
    expect(wt).toEqual(main);
  });

  it("linked worktree at a path containing spaces validates its reciprocal", () => {
    markGitDir(join(root, "repo", ".git"));
    const wtPath = join(root, "repo", "work tree");
    worktreeAdmin(join(root, "repo", ".git"), "wt", join(wtPath, ".git"));
    dotGitFile(wtPath, join(root, "repo", ".git", "worktrees", "wt"));
    expect(resolveGitCommonDir(wtPath, fs)).toEqual({
      kind: "ok",
      commonDir: real(join(root, "repo", ".git")),
    });
  });

  it("separate-git-dir main + its worktree converge (BLOCKING-A guard)", () => {
    // Primary gitdir lives outside the worktree, no commondir.
    markGitDir(join(root, "sgd"));
    dotGitFile(join(root, "main"), join(root, "sgd"));
    // A worktree of the same separate git dir.
    worktreeAdmin(join(root, "sgd"), "w", join(root, "mainwt", ".git"));
    dotGitFile(join(root, "mainwt"), join(root, "sgd", "worktrees", "w"));

    const main = resolveGitCommonDir(join(root, "main"), fs);
    const wt = resolveGitCommonDir(join(root, "mainwt"), fs);
    expect(main).toEqual({ kind: "ok", commonDir: real(join(root, "sgd")) });
    expect(wt).toEqual(main);
  });

  it("foreign_worktree_admin: .git file points into another repo's worktrees/<n> with no commondir", () => {
    // Crafted admin-shaped dir with markers but NO commondir.
    const craftedAdmin = join(root, "victim", "worktrees", "w");
    mkdirSync(craftedAdmin, { recursive: true });
    writeFileSync(join(craftedAdmin, "HEAD"), "ref: refs/heads/x\n");
    mkdirSync(join(craftedAdmin, "objects"), { recursive: true });
    dotGitFile(join(root, "hostile"), craftedAdmin);
    const r = resolveGitCommonDir(join(root, "hostile"), fs);
    expect(r).toEqual({ kind: "degraded", reason: "foreign_worktree_admin" });
  });

  it("reciprocal mismatch: admin gitdir points to a different worktree .git", () => {
    markGitDir(join(root, "repo", ".git"));
    worktreeAdmin(join(root, "repo", ".git"), "w", join(root, "OLD", ".git")); // back-pointer wrong
    dotGitFile(join(root, "repo", "wt"), join(root, "repo", ".git", "worktrees", "w"));
    const r = resolveGitCommonDir(join(root, "repo", "wt"), fs);
    expect(r).toEqual({ kind: "degraded", reason: "reciprocal_mismatch" });
  });

  it("not_git: no .git found up to root", () => {
    mkdirSync(join(root, "plain", "a"), { recursive: true });
    expect(resolveGitCommonDir(join(root, "plain", "a"), fs)).toEqual({ kind: "not_git" });
  });

  it("budget_exceeded: cwd nested deeper than the ancestor cap with no .git", () => {
    let deep = root;
    for (let i = 0; i < 40; i++) deep = join(deep, `d${i}`);
    mkdirSync(deep, { recursive: true });
    expect(resolveGitCommonDir(deep, fs)).toEqual({ kind: "degraded", reason: "budget_exceeded" });
  });

  describe("gitdir pointer parser", () => {
    it("accepts a CRLF trailing terminator", () => {
      markGitDir(join(root, "sgd"));
      mkdirSync(join(root, "main"), { recursive: true });
      writeFileSync(join(root, "main", ".git"), `gitdir: ${join(root, "sgd")}\r\n`);
      expect(resolveGitCommonDir(join(root, "main"), fs)).toEqual({
        kind: "ok",
        commonDir: real(join(root, "sgd")),
      });
    });

    it("accepts a target path containing spaces", () => {
      markGitDir(join(root, "s g d"));
      dotGitFile(join(root, "main"), join(root, "s g d"));
      expect(resolveGitCommonDir(join(root, "main"), fs)).toEqual({
        kind: "ok",
        commonDir: real(join(root, "s g d")),
      });
    });

    it("rejects two spaces after gitdir:", () => {
      markGitDir(join(root, "sgd"));
      mkdirSync(join(root, "main"), { recursive: true });
      writeFileSync(join(root, "main", ".git"), `gitdir:  ${join(root, "sgd")}\n`);
      expect(resolveGitCommonDir(join(root, "main"), fs)).toEqual({
        kind: "degraded",
        reason: "metadata_invalid",
      });
    });

    it("rejects a multi-line pointer", () => {
      markGitDir(join(root, "sgd"));
      mkdirSync(join(root, "main"), { recursive: true });
      writeFileSync(join(root, "main", ".git"), `gitdir: ${join(root, "sgd")}\nextra\n`);
      expect(resolveGitCommonDir(join(root, "main"), fs)).toEqual({
        kind: "degraded",
        reason: "metadata_invalid",
      });
    });

    it("rejects a NUL byte", () => {
      mkdirSync(join(root, "main"), { recursive: true });
      writeFileSync(join(root, "main", ".git"), "gitdir: /x\0/y\n");
      expect(resolveGitCommonDir(join(root, "main"), fs)).toEqual({
        kind: "degraded",
        reason: "metadata_invalid",
      });
    });

    it("rejects an oversize (>4KiB) pointer file", () => {
      mkdirSync(join(root, "main"), { recursive: true });
      writeFileSync(join(root, "main", ".git"), `gitdir: ${"/x".repeat(3000)}\n`);
      expect(resolveGitCommonDir(join(root, "main"), fs)).toEqual({
        kind: "degraded",
        reason: "metadata_invalid",
      });
    });

    it("rejects a missing gitdir: prefix", () => {
      mkdirSync(join(root, "main"), { recursive: true });
      writeFileSync(join(root, "main", ".git"), "notgitdir: /x\n");
      expect(resolveGitCommonDir(join(root, "main"), fs)).toEqual({
        kind: "degraded",
        reason: "metadata_invalid",
      });
    });
  });

  it("refuses a symlinked .git leaf", () => {
    markGitDir(join(root, "sgd"));
    mkdirSync(join(root, "main"), { recursive: true });
    symlinkSync(join(root, "sgd"), join(root, "main", ".git"));
    expect(resolveGitCommonDir(join(root, "main"), fs)).toEqual({
      kind: "degraded",
      reason: "metadata_invalid",
    });
  });

  it("degraded: a .git dir missing HEAD markers is metadata_invalid", () => {
    mkdirSync(join(root, "repo", ".git", "objects"), { recursive: true }); // no HEAD
    expect(resolveGitCommonDir(join(root, "repo"), fs)).toEqual({
      kind: "degraded",
      reason: "metadata_invalid",
    });
  });
});
