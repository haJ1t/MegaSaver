import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runReviewPack } from "../src/commands/review/pack.js";

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: join(tmpdir(), "megasaver-no-gitconfig"),
  GIT_CONFIG_NOSYSTEM: "1",
};
const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8", env: GIT_ENV });

describe("mega review pack", () => {
  let repo: string;
  let store: string;
  let out: string[];
  let err: string[];
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "megasaver-review-repo-"));
    store = mkdtempSync(join(tmpdir(), "megasaver-review-store-"));
    out = [];
    err = [];
    git(repo, "init");
    git(repo, "checkout", "-b", "main");
    git(repo, "config", "user.email", "test@megasaver.dev");
    git(repo, "config", "user.name", "Test");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    git(repo, "add", "a.ts");
    git(repo, "commit", "-m", "feat: seed");
    git(repo, "checkout", "-b", "feat/y");
    writeFileSync(join(repo, "a.ts"), "export const a = 2;\n");
    git(repo, "add", "a.ts");
    git(repo, "commit", "-m", "fix: bump a");
  });
  afterEach(() => {
    for (const d of [repo, store]) rmSync(d, { recursive: true, force: true });
  });

  const base = () => ({
    range: "main..HEAD",
    json: false,
    storeFlag: store,
    cwd: repo,
    home: "",
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
  });

  it("prints a digest with claims and expand pointers, exit 0", async () => {
    expect(await runReviewPack(base())).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("fix: bump a");
    expect(text).toContain("mega output chunk");
  });

  it("--json emits the pack with three chunk-set ids", async () => {
    expect(await runReviewPack({ ...base(), json: true })).toBe(0);
    const pack = JSON.parse(out.join("\n"));
    expect(Object.keys(pack.chunkSets).sort()).toEqual(["context", "diff", "manifest"]);
  });

  it("dirty tree exits 1 with a clear error and no output pack", async () => {
    writeFileSync(join(repo, "a.ts"), "// dirty\n");
    expect(await runReviewPack(base())).toBe(1);
    expect(err.join("\n")).toContain("dirty");
    expect(out).toEqual([]);
  });
});
