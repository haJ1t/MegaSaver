import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gatherGitDelta } from "../../src/git-delta.js";
import { buildWarmupHookOutput } from "../../src/hooks/warmup-run.js";
import { ensureStoreReady } from "../../src/store.js";

let root: string;
let repo: string;

function git(args: string[], cwd: string) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-warmint-store-"));
  repo = mkdtempSync(join(tmpdir(), "megasaver-warmint-repo-"));
  git(["init"], repo);
  git(["config", "user.email", "t@t"], repo);
  git(["config", "user.name", "t"], repo);
  git(["commit", "--allow-empty", "-m", "init"], repo);
  writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
  git(["add", "."], repo);
  git(["commit", "-m", "add a"], repo);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

async function seedProject() {
  const { registry } = await ensureStoreReady(root);
  registry.createProject({
    id: "11111111-1111-4111-8111-111111111111",
    name: "demo",
    rootPath: repo,
    createdAt: "2026-07-12T09:00:00.000Z",
    updatedAt: "2026-07-12T09:00:00.000Z",
  } as never);
}

describe("warm-start hook round-trip on a real repo", () => {
  it("default-branch fallback yields non-empty changedFiles", () => {
    const delta = gatherGitDelta(repo, "2020-01-01T00:00:00.000Z");
    expect(delta).not.toBeNull();
    expect(delta?.changedFiles.some((f) => f.path === "a.ts")).toBe(true);
  });

  it("SessionStart payload -> brief; second call within 4h -> micro (no git section)", async () => {
    await seedProject();
    const payload = { session_id: "s1", cwd: repo, source: "startup" };
    const first = await buildWarmupHookOutput({
      payload,
      storeRoot: root,
      now: () => Date.now(),
      gatherDelta: (cwd, seen) => gatherGitDelta(cwd, seen),
    });
    expect(first).toContain("Warm Start — demo");
    const second = await buildWarmupHookOutput({
      payload,
      storeRoot: root,
      now: () => Date.now(),
      gatherDelta: (cwd, seen) => gatherGitDelta(cwd, seen),
    });
    // first call stamped lastSeenAt=now -> gap < 4h -> micro -> no git section
    expect(second).not.toContain("Since your last visit");
  });
});
